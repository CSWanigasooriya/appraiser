//! Live screen mirroring: scrcpy's server on the phone streams H.264 video
//! and PCM audio over adb-forwarded TCP sockets and accepts input on a third
//! (see `scrcpy.rs`). Each socket is one connection to the same forwarded
//! port, opened in the order video, audio, control.

use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use super::control::{self, Input};
use super::h264::{Packet, Packetizer};
use super::{scrcpy, AdbError};

/// What the stream worker reports to its consumer.
pub enum Event {
    Packet(Packet),
    /// 48 kHz, 16-bit little-endian, stereo PCM.
    Audio(Vec<u8>),
    /// The phone's clipboard text, sent in answer to `Input::GetClipboard`.
    Clipboard(String),
    /// Something non-fatal worth telling the user (e.g. no audio capture).
    Notice(String),
    /// The stream ended on its own.
    Error(String),
}

type Callback = Arc<dyn Fn(Event) -> bool + Send + Sync>;

/// How long to wait for the phone-side server to start listening.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
/// Length of the device-name field the server sends first.
const DEVICE_META_LEN: usize = 64;
const CODEC_RAW_AUDIO: u32 = 0x0072_6177;
/// Sanity cap for a single packet from the phone.
const MAX_PACKET: usize = 32 << 20;

#[derive(Default)]
struct Handles {
    server: Option<Child>,
    /// Clones of every open socket, so `stop` can unblock their readers.
    sockets: Vec<TcpStream>,
}

pub struct Mirror {
    stop: Arc<AtomicBool>,
    handles: Arc<Mutex<Handles>>,
    control: Arc<Mutex<Option<TcpStream>>>,
}

impl Mirror {
    /// Ends the stream: killing the server and closing the sockets unblocks
    /// the worker threads, which then clean up.
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        let mut h = self.handles.lock().unwrap();
        if let Some(server) = h.server.as_mut() {
            let _ = server.kill();
        }
        for socket in &h.sockets {
            let _ = socket.shutdown(Shutdown::Both);
        }
    }

    /// Sends an input event to the phone. Fails if the session isn't live yet.
    pub fn send_input(&self, input: &Input) -> Result<(), AdbError> {
        let mut guard = self.control.lock().unwrap();
        let socket = guard.as_mut().ok_or_else(|| AdbError::Failed("Mirroring is not running".into()))?;
        Ok(socket.write_all(&control::encode(input))?)
    }
}

impl Drop for Mirror {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Starts mirroring on a background thread. `on_event` returns `false` once
/// the consumer is gone, which ends the stream.
pub fn start(serial: &str, on_event: impl Fn(Event) -> bool + Send + Sync + 'static) -> Mirror {
    let stop = Arc::new(AtomicBool::new(false));
    let handles = Arc::new(Mutex::new(Handles::default()));
    let control = Arc::new(Mutex::new(None));
    let mirror = Mirror { stop: stop.clone(), handles: handles.clone(), control: control.clone() };
    let serial = serial.to_string();
    let on_event: Callback = Arc::new(on_event);
    thread::spawn(move || {
        let result = session(&serial, &stop, &handles, &control, &on_event);
        *control.lock().unwrap() = None;
        {
            let mut h = handles.lock().unwrap();
            for socket in h.sockets.drain(..) {
                let _ = socket.shutdown(Shutdown::Both);
            }
            if let Some(mut server) = h.server.take() {
                let _ = server.kill();
                let _ = server.wait();
            }
        }
        if let Err(e) = result {
            if !stop.load(Ordering::SeqCst) {
                on_event(Event::Error(e.to_string()));
            }
        }
    });
    mirror
}

fn session(
    serial: &str,
    stop: &AtomicBool,
    handles: &Mutex<Handles>,
    control: &Mutex<Option<TcpStream>>,
    on_event: &Callback,
) -> Result<(), AdbError> {
    scrcpy::ensure_server(serial)?;
    let scid = scrcpy::new_scid();
    let port = scrcpy::forward(serial, &scid)?;
    let _forward = ForwardGuard { serial, port };

    let mut server = scrcpy::spawn_server(serial, &scid)?;
    let logs = Arc::new(Mutex::new(String::new()));
    drain(server.stdout.take(), logs.clone());
    drain(server.stderr.take(), logs.clone());
    handles.lock().unwrap().server = Some(server);
    if stop.load(Ordering::SeqCst) {
        return Ok(()); // stop() ran before the server was stored
    }

    let mut video = connect_first(port, stop, handles, &logs)?;
    // The server accepts in this order once the first connection is up.
    let audio = TcpStream::connect(("127.0.0.1", port))?;
    let control_socket = TcpStream::connect(("127.0.0.1", port))?;
    for s in [&video, &audio, &control_socket] {
        let _ = s.set_nodelay(true);
        if let Ok(clone) = s.try_clone() {
            handles.lock().unwrap().sockets.push(clone);
        }
    }
    if stop.load(Ordering::SeqCst) {
        return Ok(());
    }

    // Input goes out on the control socket. What the phone sends back is read
    // so the server never blocks; clipboard contents are passed on.
    *control.lock().unwrap() = control_socket.try_clone().ok();
    let control_cb = on_event.clone();
    thread::spawn(move || read_device_messages(control_socket, &control_cb));

    let audio_cb = on_event.clone();
    thread::spawn(move || read_audio(audio, &audio_cb));

    read_video(&mut video, on_event);

    if stop.load(Ordering::SeqCst) {
        return Ok(());
    }
    let log = logs.lock().unwrap().trim().to_string();
    Err(AdbError::Failed(if log.is_empty() { "The screen stream ended unexpectedly".into() } else { log }))
}

struct ForwardGuard<'a> {
    serial: &'a str,
    port: u16,
}

impl Drop for ForwardGuard<'_> {
    fn drop(&mut self) {
        scrcpy::remove_forward(self.serial, self.port);
    }
}

/// Collects the tail of a pipe's output (for error messages) and keeps it
/// drained so the writer never blocks.
fn drain(pipe: Option<impl Read + Send + 'static>, into: Arc<Mutex<String>>) {
    let Some(mut pipe) = pipe else { return };
    thread::spawn(move || {
        let mut buf = [0u8; 1024];
        while let Ok(n) = pipe.read(&mut buf) {
            if n == 0 {
                break;
            }
            let mut log = into.lock().unwrap();
            log.push_str(&String::from_utf8_lossy(&buf[..n]));
            if log.len() > 2000 {
                let cut = log.len() - 2000;
                *log = log.split_at(log.ceil_char_boundary(cut)).1.to_string();
            }
        }
    });
}

/// `adb forward` accepts connections before the phone is listening and then
/// drops them, so retry until the server's dummy byte arrives (and consume it).
fn connect_first(
    port: u16,
    stop: &AtomicBool,
    handles: &Mutex<Handles>,
    logs: &Mutex<String>,
) -> Result<TcpStream, AdbError> {
    let deadline = Instant::now() + CONNECT_TIMEOUT;
    while Instant::now() < deadline && !stop.load(Ordering::SeqCst) {
        if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
            let mut dummy = [0u8; 1];
            while Instant::now() < deadline && !stop.load(Ordering::SeqCst) {
                match stream.read(&mut dummy) {
                    Ok(0) => break, // dropped: server not listening yet, reconnect
                    Ok(_) => {
                        let _ = stream.set_read_timeout(None);
                        return Ok(stream);
                    }
                    Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {
                        if server_exited(handles) {
                            return Err(server_error(logs));
                        }
                    }
                    Err(_) => break,
                }
            }
        }
        if server_exited(handles) {
            return Err(server_error(logs));
        }
        thread::sleep(Duration::from_millis(100));
    }
    if stop.load(Ordering::SeqCst) {
        return Err(AdbError::Failed("stopped".into()));
    }
    Err(AdbError::Failed("Timed out waiting for the screen server on the phone to start".into()))
}

fn server_exited(handles: &Mutex<Handles>) -> bool {
    handles.lock().unwrap().server.as_mut().is_some_and(|s| matches!(s.try_wait(), Ok(Some(_))))
}

/// The server exited (bad args, version mismatch...): report why.
fn server_error(logs: &Mutex<String>) -> AdbError {
    let log = logs.lock().unwrap().trim().to_string();
    AdbError::Failed(if log.is_empty() { "The scrcpy server exited".into() } else { log })
}

/// Reads one 12-byte header and its payload. Returns the header's first byte
/// (flags) and the payload, or `None` at EOF / on a bad size. A session packet
/// (bit 7 set, announcing the video size) is header-only: empty payload.
fn read_packet(r: &mut impl Read) -> Option<(u8, Vec<u8>)> {
    let mut header = [0u8; 12];
    r.read_exact(&mut header).ok()?;
    if header[0] & 0x80 != 0 {
        return Some((header[0], Vec::new()));
    }
    let size = u32::from_be_bytes(header[8..12].try_into().unwrap()) as usize;
    if size > MAX_PACKET {
        return None;
    }
    let mut payload = vec![0u8; size];
    r.read_exact(&mut payload).ok()?;
    Some((header[0], payload))
}

fn read_video(stream: &mut TcpStream, on_event: &Callback) {
    let mut meta = [0u8; DEVICE_META_LEN + 4]; // device name, then the codec id
    if stream.read_exact(&mut meta).is_err() {
        return;
    }
    let mut packetizer = Packetizer::default();
    let mut out = Vec::new();
    while let Some((flags, payload)) = read_packet(stream) {
        // Bit 7 marks a session packet (video size change), not a media packet.
        if flags & 0x80 != 0 {
            continue;
        }
        // Packets are complete NAL units, so there's nothing to wait for.
        packetizer.push(&payload, &mut out);
        packetizer.flush(&mut out);
        for packet in out.drain(..) {
            if !on_event(Event::Packet(packet)) {
                return;
            }
        }
    }
}

fn read_device_messages(mut stream: TcpStream, on_event: &Callback) {
    while let Ok(message) = control::read_device_message(&mut stream) {
        if let Some(text) = message {
            if !on_event(Event::Clipboard(text)) {
                return;
            }
        }
    }
}

fn read_audio(mut stream: TcpStream, on_event: &Callback) {
    let mut codec = [0u8; 4];
    if stream.read_exact(&mut codec).is_err() {
        return;
    }
    if u32::from_be_bytes(codec) != CODEC_RAW_AUDIO {
        // 0 = disabled, 1 = the phone couldn't capture audio.
        on_event(Event::Notice("This phone can't share its audio (needs Android 11 or newer).".into()));
        return;
    }
    while let Some((flags, payload)) = read_packet(&mut stream) {
        if flags & 0x80 == 0 && !on_event(Event::Audio(payload)) {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_framed_packets() {
        let mut data = vec![0u8; 8];
        data.extend(3u32.to_be_bytes());
        data.extend([1, 2, 3]);
        let mut r = std::io::Cursor::new(data);
        assert_eq!(read_packet(&mut r), Some((0, vec![1, 2, 3])));
        assert_eq!(read_packet(&mut r), None);
    }

    #[test]
    fn session_packets_have_no_payload() {
        // width 580, height 1280: the last field is not a size.
        let mut data = vec![0x80, 0, 0, 0];
        data.extend(580u32.to_be_bytes());
        data.extend(1280u32.to_be_bytes());
        data.extend([9, 9]); // the next bytes belong to the next packet
        let mut r = std::io::Cursor::new(data);
        assert_eq!(read_packet(&mut r), Some((0x80, vec![])));
        assert_eq!(r.position(), 12);
    }

    #[test]
    fn rejects_absurd_packet_sizes() {
        let mut data = vec![0u8; 8];
        data.extend(u32::MAX.to_be_bytes());
        assert_eq!(read_packet(&mut std::io::Cursor::new(data)), None);
    }

    /// Needs a connected device:
    /// `APPRAISER_SERIAL=<serial> cargo test -- --ignored mirror_live --nocapture`
    #[test]
    #[ignore]
    fn mirror_live() {
        use std::sync::mpsc;
        let serial = std::env::var("APPRAISER_SERIAL").unwrap();
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let mirror = start(&serial, move |e| tx.lock().unwrap().send(e).is_ok());
        let deadline = Instant::now() + Duration::from_secs(10);
        let (mut configs, mut frames, mut audio) = (0, 0, 0usize);
        let mut sent = false;
        while let Some(left) = deadline.checked_duration_since(Instant::now()) {
            match rx.recv_timeout(left) {
                Ok(Event::Packet(Packet::Config { codec, .. })) => {
                    configs += 1;
                    println!("config {codec}");
                }
                Ok(Event::Packet(Packet::Frame { .. })) => {
                    frames += 1;
                    if !sent {
                        sent = true;
                        // A harmless keypress (KEYCODE_SHIFT_LEFT) proves the control socket works.
                        mirror.send_input(&Input::Key { keycode: 59 }).unwrap();
                    }
                }
                Ok(Event::Audio(b)) => audio += b.len(),
                Ok(Event::Notice(n)) => println!("notice: {n}"),
                Ok(Event::Clipboard(_)) => {}
                Ok(Event::Error(e)) => panic!("stream error: {e}"),
                Err(_) => break,
            }
        }
        mirror.stop();
        println!("configs={configs} frames={frames} audio_bytes={audio} input_sent={sent}");
        assert!(configs >= 1);
    }
}
