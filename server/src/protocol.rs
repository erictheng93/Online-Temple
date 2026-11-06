use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const MAX_MESSAGE_BYTES: usize = 16 * 1024;
pub const PROTOCOL_VERSION: f64 = 1.0;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ClientMessage {
    Hello {
        v: f64,
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        resume_token: Option<String>,
    },
    Move {
        x: f64,
        z: f64,
        heading: f64,
        seq: f64,
    },
    Stop {
        x: f64,
        z: f64,
        heading: f64,
        seq: f64,
    },
    Action {
        req_id: String,
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<Map<String, Value>>,
    },
    Ping {
        ts: f64,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerAction {
    pub id: String,
    pub started_at: f64,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct PlayerSnapshot {
    pub id: String,
    pub name: String,
    pub x: f64,
    pub z: f64,
    pub heading: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<PlayerAction>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
#[derive(Clone, Copy)]
pub enum Moving {
    Stopped,
    Moving,
}
impl TryFrom<u8> for Moving {
    type Error = &'static str;
    fn try_from(v: u8) -> Result<Self, Self::Error> {
        match v {
            0 => Ok(Self::Stopped),
            1 => Ok(Self::Moving),
            _ => Err("moving must be 0 or 1"),
        }
    }
}
impl From<Moving> for u8 {
    fn from(v: Moving) -> Self {
        match v {
            Moving::Stopped => 0,
            Moving::Moving => 1,
        }
    }
}
pub type MoveTuple = (String, f64, f64, f64, Moving);

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ServerMessage {
    Welcome {
        self_id: String,
        room: String,
        resume_token: String,
        server_time: f64,
        players: Vec<PlayerSnapshot>,
    },
    Join {
        player: PlayerSnapshot,
    },
    Leave {
        id: String,
    },
    Move {
        id: String,
        x: f64,
        z: f64,
        heading: f64,
        moving: bool,
    },
    Moves {
        m: Vec<MoveTuple>,
    },
    Action {
        player_id: String,
        id: String,
        started_at: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<Map<String, Value>>,
    },
    Ack {
        req_id: String,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    Pong {
        ts: f64,
        server_time: f64,
    },
    Error {
        code: String,
        message: String,
    },
}

pub fn clean_name(name: &str) -> String {
    let filtered: String = name.chars().filter(|c| !c.is_control()).collect();
    let name: String = filtered.trim().chars().take(16).collect();
    if name.is_empty() {
        "訪客".into()
    } else {
        name
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_names() {
        for (input, expected) in [
            ("　小明　", "小明"),
            ("\n a\nb\t", "ab"),
            ("　\n", "訪客"),
            ("😀😀", "😀😀"),
            ("12345678901234567", "1234567890123456"),
        ] {
            assert_eq!(clean_name(input), expected);
        }
        assert_eq!(clean_name(&"😀".repeat(17)).chars().count(), 16);
    }
}
