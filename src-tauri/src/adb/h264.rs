//! Splits an Annex-B H.264 byte stream (what `screenrecord` emits) into the
//! pieces a WebCodecs decoder wants: an `avcC` config record, and
//! length-prefixed (AVCC) frames.

#[derive(Debug, PartialEq, Eq)]
pub enum Packet {
    /// Codec string (e.g. `avc1.640028`) and `avcC` description.
    Config { codec: String, avcc: Vec<u8> },
    Frame { key: bool, data: Vec<u8> },
}

#[derive(Default)]
pub struct Packetizer {
    buf: Vec<u8>,
    sps: Option<Vec<u8>>,
    pps: Option<Vec<u8>>,
    sent: Option<(Vec<u8>, Vec<u8>)>,
}

impl Packetizer {
    /// Feeds stream bytes; emits packets for every NAL unit that is known to
    /// be complete (i.e. followed by another start code).
    pub fn push(&mut self, chunk: &[u8], out: &mut Vec<Packet>) {
        self.buf.extend_from_slice(chunk);
        let Some(first) = find_start(&self.buf, 0) else {
            // No start code yet; keep a tail in case one straddles chunks.
            let keep = self.buf.len().saturating_sub(2);
            self.buf.drain(..keep);
            return;
        };
        self.buf.drain(..first);

        while let Some(next) = find_start(&self.buf, 3) {
            let nal = trim_zeros(&self.buf[3..next]).to_vec();
            self.buf.drain(..next);
            self.handle(&nal, out);
        }
    }

    /// Treats the buffered tail as a complete NAL unit. Called when the
    /// stream goes quiet: otherwise the last frame before a still screen
    /// would sit unemitted until the screen changes again.
    pub fn flush(&mut self, out: &mut Vec<Packet>) {
        if self.buf.len() > 3 && self.buf.starts_with(&[0, 0, 1]) {
            let nal = trim_zeros(&self.buf[3..]).to_vec();
            self.buf.clear();
            self.handle(&nal, out);
        }
    }

    fn handle(&mut self, nal: &[u8], out: &mut Vec<Packet>) {
        let Some(&header) = nal.first() else { return };
        match header & 0x1f {
            7 => self.sps = Some(nal.to_vec()),
            8 => {
                self.pps = Some(nal.to_vec());
                if let (Some(sps), Some(pps)) = (&self.sps, &self.pps) {
                    if sps.len() >= 4 && self.sent.as_ref() != Some(&(sps.clone(), pps.clone())) {
                        out.push(config(sps, pps));
                        self.sent = Some((sps.clone(), pps.clone()));
                    }
                }
            }
            t @ (1 | 5) => {
                let mut data = Vec::with_capacity(nal.len() + 4);
                data.extend_from_slice(&(nal.len() as u32).to_be_bytes());
                data.extend_from_slice(nal);
                out.push(Packet::Frame { key: t == 5, data });
            }
            _ => {}
        }
    }
}

fn config(sps: &[u8], pps: &[u8]) -> Packet {
    let mut avcc = vec![1, sps[1], sps[2], sps[3], 0xff, 0xe1];
    avcc.extend_from_slice(&(sps.len() as u16).to_be_bytes());
    avcc.extend_from_slice(sps);
    avcc.push(1);
    avcc.extend_from_slice(&(pps.len() as u16).to_be_bytes());
    avcc.extend_from_slice(pps);
    Packet::Config { codec: format!("avc1.{:02x}{:02x}{:02x}", sps[1], sps[2], sps[3]), avcc }
}

/// Index of the next `00 00 01` at or after `from`.
fn find_start(buf: &[u8], from: usize) -> Option<usize> {
    buf.get(from..)?.windows(3).position(|w| w == [0, 0, 1]).map(|i| i + from)
}

/// The zero before a 4-byte start code (`00 00 00 01`) belongs to the start
/// code, not the NAL before it.
fn trim_zeros(nal: &[u8]) -> &[u8] {
    let end = nal.iter().rposition(|&b| b != 0).map_or(0, |i| i + 1);
    &nal[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPS: [u8; 5] = [0x67, 0x64, 0x00, 0x28, 0xac];
    const PPS: [u8; 2] = [0x68, 0xee];

    fn stream() -> Vec<u8> {
        let mut s = vec![0, 0, 0, 1];
        s.extend(SPS);
        s.extend([0, 0, 0, 1]);
        s.extend(PPS);
        s.extend([0, 0, 0, 1, 0x65, 1, 2, 3]); // IDR
        s.extend([0, 0, 1, 0x41, 9, 9]); // P frame
        s.extend([0, 0, 0, 1, 0x41, 7]); // next P, never completed
        s
    }

    #[test]
    fn emits_config_then_frames_and_holds_back_last_nal() {
        let mut p = Packetizer::default();
        let mut out = vec![];
        p.push(&stream(), &mut out);
        assert!(matches!(&out[0], Packet::Config { codec, .. } if codec == "avc1.640028"));
        assert_eq!(out[1], Packet::Frame { key: true, data: vec![0, 0, 0, 4, 0x65, 1, 2, 3] });
        assert_eq!(out[2], Packet::Frame { key: false, data: vec![0, 0, 0, 3, 0x41, 9, 9] });
        assert_eq!(out.len(), 3);

        p.flush(&mut out);
        assert_eq!(out[3], Packet::Frame { key: false, data: vec![0, 0, 0, 2, 0x41, 7] });
    }

    #[test]
    fn handles_arbitrary_chunk_boundaries() {
        let whole = {
            let mut p = Packetizer::default();
            let mut out = vec![];
            p.push(&stream(), &mut out);
            p.flush(&mut out);
            out
        };
        for size in 1..8 {
            let mut p = Packetizer::default();
            let mut out = vec![];
            for c in stream().chunks(size) {
                p.push(c, &mut out);
            }
            p.flush(&mut out);
            assert_eq!(out, whole, "chunk size {size}");
        }
    }

    #[test]
    fn repeated_identical_config_is_sent_once() {
        let mut s = stream();
        s.extend(stream());
        let mut p = Packetizer::default();
        let mut out = vec![];
        p.push(&s, &mut out);
        p.flush(&mut out);
        let configs = out.iter().filter(|x| matches!(x, Packet::Config { .. })).count();
        assert_eq!(configs, 1);
    }
}
