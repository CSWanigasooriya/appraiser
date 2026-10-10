//! Live `logcat` streaming. Lines are batched so a chatty phone doesn't turn
//! into one UI event per line.

use std::io::{BufRead, BufReader, Read};
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use super::{runner, AdbError};

pub enum Event {
    /// A batch of complete log lines, oldest first.
    Lines(Vec<String>),
    /// The stream ended on its own (device gone, adb died).
    Ended(String),
}

/// Lines already in the phone's buffer to replay when streaming starts.
const BACKLOG: &str = "500";
/// A batch is sent at least this often while lines are arriving...
const FLUSH_EVERY: Duration = Duration::from_millis(40);
/// ...or as soon as it holds this many.
const MAX_BATCH: usize = 1000;

pub struct LogStream {
    stop: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
}

impl LogStream {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(child) = self.child.lock().unwrap().as_mut() {
            let _ = child.kill();
        }
    }
}

impl Drop for LogStream {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Starts streaming on a background thread. `on_event` returns `false` once
/// the consumer is gone, which ends the stream.
pub fn start(serial: &str, on_event: impl Fn(Event) -> bool + Send + 'static) -> Result<LogStream, AdbError> {
    let mut child = runner::spawn_stream(&["-s", serial, "logcat", "-v", "threadtime", "-T", BACKLOG])?;
    let stdout = child.stdout.take().expect("stdout is piped");
    let mut stderr = child.stderr.take().expect("stderr is piped");

    let stop = Arc::new(AtomicBool::new(false));
    let slot = Arc::new(Mutex::new(Some(child)));
    let stream = LogStream { stop: stop.clone(), child: slot.clone() };

    thread::spawn(move || {
        let consumer_gone = pump(stdout, &on_event);
        if let Some(mut child) = slot.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if consumer_gone || stop.load(Ordering::SeqCst) {
            return;
        }
        let mut msg = String::new();
        let _ = stderr.read_to_string(&mut msg);
        let msg = msg.trim();
        on_event(Event::Ended(if msg.is_empty() { "The log stream ended".into() } else { msg.into() }));
    });
    Ok(stream)
}

/// Reads lines until EOF, sending them in batches. Returns `true` if the
/// consumer went away first.
fn pump(stdout: impl Read + Send + 'static, on_event: &dyn Fn(Event) -> bool) -> bool {
    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if tx.send(clean_line(&buf)).is_err() {
                        break;
                    }
                }
            }
        }
    });

    let mut batch: Vec<String> = Vec::new();
    let mut last_flush = Instant::now();
    loop {
        let wait = FLUSH_EVERY.saturating_sub(last_flush.elapsed()).max(Duration::from_millis(1));
        let done = match rx.recv_timeout(wait) {
            Ok(line) => {
                batch.push(line);
                false
            }
            Err(RecvTimeoutError::Timeout) => false,
            Err(RecvTimeoutError::Disconnected) => true,
        };
        if !batch.is_empty() && (done || batch.len() >= MAX_BATCH || last_flush.elapsed() >= FLUSH_EVERY) {
            if !on_event(Event::Lines(std::mem::take(&mut batch))) {
                return true;
            }
            last_flush = Instant::now();
        }
        if done {
            return false;
        }
    }
}

/// One line of raw output as text, without its line ending. Logs can contain
/// invalid UTF-8, which is replaced rather than dropped.
fn clean_line(raw: &[u8]) -> String {
    String::from_utf8_lossy(raw).trim_end_matches(['\n', '\r']).to_string()
}

/// Empties the phone's log buffers, so the next stream starts from a clean slate.
pub fn clear(serial: &str) -> Result<(), AdbError> {
    runner::run(&["-s", serial, "logcat", "-c"]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn cleans_line_endings_and_bad_utf8() {
        assert_eq!(clean_line(b"hello\r\n"), "hello");
        assert_eq!(clean_line(b"a\xffb\n"), "a\u{fffd}b");
    }

    #[test]
    fn batches_every_line_in_order() {
        let input = (0..2500).map(|i| format!("line {i}\n")).collect::<String>();
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = seen.clone();
        let gone = pump(Cursor::new(input.into_bytes()), &move |e| {
            if let Event::Lines(l) = e {
                sink.lock().unwrap().extend(l);
            }
            true
        });
        assert!(!gone);
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 2500);
        assert_eq!(seen[0], "line 0");
        assert_eq!(seen[2499], "line 2499");
    }

    #[test]
    fn stops_when_the_consumer_goes_away() {
        let input = "a\nb\nc\n".repeat(100);
        assert!(pump(Cursor::new(input.into_bytes()), &|_| false));
    }

    /// Needs a connected device: `APPRAISER_SERIAL=<serial> cargo test -- --ignored logcat_live --nocapture`
    #[test]
    #[ignore]
    fn logcat_live() {
        let serial = std::env::var("APPRAISER_SERIAL").unwrap();
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let stream = start(&serial, move |e| tx.lock().unwrap().send(e).is_ok()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(4);
        let (mut batches, mut lines, mut first) = (0, 0, None);
        while let Some(left) = deadline.checked_duration_since(Instant::now()) {
            match rx.recv_timeout(left) {
                Ok(Event::Lines(l)) => {
                    batches += 1;
                    lines += l.len();
                    first.get_or_insert_with(|| l[0].clone());
                }
                Ok(Event::Ended(r)) => panic!("ended: {r}"),
                Err(_) => break,
            }
        }
        stream.stop();
        println!("batches={batches} lines={lines} first={first:?}");
        assert!(lines > 0);
    }
}
