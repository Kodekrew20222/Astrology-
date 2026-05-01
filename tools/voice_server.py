import os
import base64
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import edge_tts
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field


DEFAULT_VOICE = os.getenv("VOICE_NAME", "hi-IN-MadhurNeural")
DEFAULT_RATE = os.getenv("VOICE_RATE", "+0%")
DEFAULT_PITCH = os.getenv("VOICE_PITCH", "+0Hz")
DEFAULT_VOLUME = os.getenv("VOICE_VOLUME", "+0%")
MAX_TEXT_CHARS = int(os.getenv("VOICE_MAX_TEXT_CHARS", "6000"))
RHUBARB_PATH = os.getenv(
    "RHUBARB_PATH",
    "tools/rhubarb/Rhubarb-Lip-Sync-1.14.0-macOS/rhubarb",
)

app = FastAPI(title="Local Neural Voice Bridge")
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_headers=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_origins=["*"],
)


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1)
    voice: str = DEFAULT_VOICE
    rate: Optional[str] = DEFAULT_RATE
    pitch: Optional[str] = DEFAULT_PITCH
    volume: Optional[str] = DEFAULT_VOLUME


@app.get("/health")
def health():
    return {"ready": True, "voice": DEFAULT_VOICE}


@app.post("/speak")
async def speak(payload: SpeakRequest):
    text = " ".join(payload.text.split())
    if len(text) > MAX_TEXT_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Text is too long for one voice request. Max is {MAX_TEXT_CHARS} characters.",
        )

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as output_file:
        output_path = output_file.name

    try:
        communicate = edge_tts.Communicate(
            text,
            payload.voice or DEFAULT_VOICE,
            rate=payload.rate or DEFAULT_RATE,
            pitch=payload.pitch or DEFAULT_PITCH,
            volume=payload.volume or DEFAULT_VOLUME,
        )
        await communicate.save(output_path)

        audio = Path(output_path).read_bytes()
        if not audio:
            raise HTTPException(status_code=502, detail="Voice service returned empty audio.")

        return Response(
            audio,
            headers={"Cache-Control": "no-store"},
            media_type="audio/mpeg",
        )
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    finally:
        Path(output_path).unlink(missing_ok=True)


def convert_mp3_to_wav(mp3_path: str, wav_path: str):
    subprocess.run(
        [
            "afconvert",
            "-f",
            "WAVE",
            "-d",
            "LEI16@16000",
            "-c",
            "1",
            mp3_path,
            wav_path,
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def run_rhubarb(wav_path: str, dialog_path: str, cues_path: str):
    rhubarb_path = Path(RHUBARB_PATH)
    if not rhubarb_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Rhubarb binary not found at {rhubarb_path}",
        )

    subprocess.run(
        [
            str(rhubarb_path),
            "-r",
            "phonetic",
            "-f",
            "json",
            "-d",
            dialog_path,
            "-o",
            cues_path,
            wav_path,
        ],
        check=True,
        capture_output=True,
        text=True,
    )


@app.post("/speak-with-cues")
async def speak_with_cues(payload: SpeakRequest):
    text = " ".join(payload.text.split())
    if len(text) > MAX_TEXT_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Text is too long for one voice request. Max is {MAX_TEXT_CHARS} characters.",
        )

    temp_paths: list[str] = []

    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as audio_file:
            mp3_path = audio_file.name
            temp_paths.append(mp3_path)

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as wav_file:
            wav_path = wav_file.name
            temp_paths.append(wav_path)

        with tempfile.NamedTemporaryFile(suffix=".txt", mode="w", encoding="utf-8", delete=False) as dialog_file:
            dialog_file.write(text)
            dialog_path = dialog_file.name
            temp_paths.append(dialog_path)

        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as cues_file:
            cues_path = cues_file.name
            temp_paths.append(cues_path)

        communicate = edge_tts.Communicate(
            text,
            payload.voice or DEFAULT_VOICE,
            rate=payload.rate or DEFAULT_RATE,
            pitch=payload.pitch or DEFAULT_PITCH,
            volume=payload.volume or DEFAULT_VOLUME,
        )
        await communicate.save(mp3_path)

        audio = Path(mp3_path).read_bytes()
        if not audio:
            raise HTTPException(status_code=502, detail="Voice service returned empty audio.")

        convert_mp3_to_wav(mp3_path, wav_path)
        run_rhubarb(wav_path, dialog_path, cues_path)

        cue_data = json.loads(Path(cues_path).read_text(encoding="utf-8"))
        return {
            "audioBase64": base64.b64encode(audio).decode("ascii"),
            "contentType": "audio/mpeg",
            "mouthCues": cue_data.get("mouthCues", []),
            "voice": payload.voice or DEFAULT_VOICE,
        }
    except subprocess.CalledProcessError as error:
        message = error.stderr or error.stdout or str(error)
        raise HTTPException(status_code=502, detail=message) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    finally:
        for temp_path in temp_paths:
            Path(temp_path).unlink(missing_ok=True)


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("VOICE_HOST", "127.0.0.1")
    port = int(os.getenv("VOICE_PORT", "8020"))
    uvicorn.run("voice_server:app", host=host, port=port, reload=False)
