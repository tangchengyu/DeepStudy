"""Generate breathing guides and the cue timeline used by the renderer.

The audio files are built as fixed-duration slots so the renderer can sync the
circle directly to media time. Online neural TTS is preferred for quality, with
Windows SAPI kept as a local fallback.
"""

from __future__ import annotations

import asyncio
import base64
import json
import math
import os
import re
import time
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
import wave


OUTPUT_DIR = Path(__file__).resolve().parents[1] / "renderer" / "assets" / "audio"
SAMPLE_RATE = 24_000
BOX_SPEECH_SECONDS = 4.0
BOX_SILENCE_SECONDS = 4.0
BOX_BEAT_INTERVAL_SECONDS = 4.0
BOX_VOICE_OFFSET_SECONDS = 0.35
BOX_VOICE_SECONDS = 3.25
WIM_COUNT_SECONDS = 2.0
PROMPT_SECONDS = 3.0
PREPARE_SECONDS = 4.0

BOX_SEGMENTS = [
    ("腹式呼吸", 1.0),
    ("舒适坐躺", 0.96),
    ("闭目静养", 0.92),
    ("鼻吸嘴呼", 1.08),
    ("深吸缓呼", 1.16),
    ("身体由紧", 1.08),
    ("渐至松爽", 0.94),
    ("局部放松", 0.9),
    ("整体放松", 0.86),
    ("感知呼吸", 1.02),
    ("美景远方", 1.1),
    ("吸气伸展", 1.18),
    ("呼气松绑", 0.9),
    ("从上到下", 0.98),
    ("扫描全身", 0.94),
    ("意念轻转", 1.03),
    ("协调通畅", 1.08),
    ("头脑散热", 0.94),
    ("四肢发烫", 1.06),
    ("吸气紧张", 1.18),
    ("呼气释放", 0.88),
    ("三至五轮", 1.04),
    ("神清气爽", 1.1),
    ("感知身体", 1.0),
    ("情绪涟漪", 0.96),
    ("事物对象", 0.98),
    ("脑中泛起", 0.94),
    ("两眼之间", 1.0),
    ("心念齐聚", 0.94),
]

CHINESE_NUMBERS = [
    "一",
    "二",
    "三",
    "四",
    "五",
    "六",
    "七",
    "八",
    "九",
    "十",
    "十一",
    "十二",
    "十三",
    "十四",
    "十五",
    "十六",
    "十七",
    "十八",
    "十九",
    "二十",
    "二十一",
    "二十二",
    "二十三",
    "二十四",
    "二十五",
    "二十六",
    "二十七",
    "二十八",
    "二十九",
    "三十",
]


def powershell_literal(value: str) -> str:
    return value.replace("'", "''")


def ffmpeg_path() -> str:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        found = shutil.which("ffmpeg")
        if found:
            return found
    raise RuntimeError(
        "ffmpeg is required. Install imageio-ffmpeg or put ffmpeg on PATH."
    )


def run(command: list[str]) -> None:
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def safe_error(error: Exception) -> str:
    message = str(error)
    for secret in (
        os.environ.get("GEMINI_API_KEY"),
        os.environ.get("GOOGLE_API_KEY"),
        os.environ.get("MINIMAX_API_KEY"),
    ):
        if secret:
            message = message.replace(secret, "[redacted]")
    return message


def audio_stem(index: int) -> str:
    return f"box-{index + 1:02d}"


def minimax_payload(text: str, audio_format: str = "mp3") -> dict:
    return {
        "model": os.environ.get("MINIMAX_TTS_MODEL", "speech-2.8-hd"),
        "text": text,
        "stream": False,
        "language_boost": "Chinese",
        "output_format": "hex",
        "voice_setting": {
            "voice_id": os.environ.get(
                "MINIMAX_TTS_VOICE", "Chinese (Mandarin)_Gentleman"
            ),
            "speed": float(os.environ.get("MINIMAX_TTS_SPEED", "0.8")),
            "vol": float(os.environ.get("MINIMAX_TTS_VOLUME", "1")),
            "pitch": int(os.environ.get("MINIMAX_TTS_PITCH", "-1")),
            "emotion": os.environ.get("MINIMAX_TTS_EMOTION", "calm"),
        },
        "audio_setting": {
            "sample_rate": int(os.environ.get("MINIMAX_TTS_SAMPLE_RATE", "32000")),
            "bitrate": int(os.environ.get("MINIMAX_TTS_BITRATE", "192000")),
            "format": audio_format,
            "channel": 1,
        },
        "subtitle_enable": False,
    }


def minimax_tts(text: str, audio_format: str = "mp3") -> bytes:
    api_key = os.environ.get("MINIMAX_API_KEY")
    if not api_key:
        raise RuntimeError("set MINIMAX_API_KEY to enable MiniMax TTS")

    endpoint = os.environ.get("MINIMAX_TTS_ENDPOINT", "https://api.minimax.io/v1/t2a_v2")
    payload = json.dumps(minimax_payload(text, audio_format)).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(
            request, timeout=float(os.environ.get("MINIMAX_TTS_TIMEOUT", "90"))
        ) as response:
            body = response.read()
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"MiniMax TTS HTTP {error.code}: {body}") from error
    result = json.loads(body.decode("utf-8"))
    base_resp = result.get("base_resp") or {}
    if base_resp.get("status_code") not in (None, 0):
        raise RuntimeError(f"MiniMax TTS failed: {base_resp}")
    audio_hex = (result.get("data") or {}).get("audio")
    if not audio_hex:
        raise RuntimeError(f"MiniMax TTS returned no audio: {result}")
    return bytes.fromhex(audio_hex)


def synthesize_minimax_segments(segments: list[str], directory: Path) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    manifest = {
        "provider": "MiniMax",
        "model": os.environ.get("MINIMAX_TTS_MODEL", "speech-2.8-hd"),
        "voice_id": os.environ.get("MINIMAX_TTS_VOICE", "Chinese (Mandarin)_Gentleman"),
        "speed": float(os.environ.get("MINIMAX_TTS_SPEED", "0.8")),
        "pitch": int(os.environ.get("MINIMAX_TTS_PITCH", "-1")),
        "emotion": os.environ.get("MINIMAX_TTS_EMOTION", "calm"),
        "voice_offset_seconds": BOX_VOICE_OFFSET_SECONDS,
        "segments": [],
    }
    targets: list[Path] = []
    min_interval = float(os.environ.get("MINIMAX_TTS_MIN_INTERVAL_SECONDS", "0.35"))
    force = os.environ.get("MINIMAX_TTS_FORCE", "0") == "1"
    previous_request_at = 0.0
    for index, text in enumerate(segments):
        target = directory / f"{audio_stem(index)}.mp3"
        if force or not target.exists():
            elapsed = time.monotonic() - previous_request_at
            if previous_request_at and elapsed < min_interval:
                time.sleep(min_interval - elapsed)
            previous_request_at = time.monotonic()
            target.write_bytes(minimax_tts(text, "mp3"))
        targets.append(target)
        manifest["segments"].append(
            {"index": index + 1, "text": text, "mp3": target.name, "wav": f"{audio_stem(index)}.wav"}
        )
    (directory / "box_segments.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return targets


def gemini_daily_quota_exhausted(error: Exception) -> bool:
    message = str(error)
    return (
        "generate_requests_per_model_per_day" in message
        or "GenerateRequestsPerDayPerProjectPerModel" in message
    )


def gemini_retry_seconds(error: Exception) -> float | None:
    message = str(error)
    if gemini_daily_quota_exhausted(error):
        return None
    if "inline audio data" in message:
        return 10.0
    retry_match = re.search(r"retryDelay': '(\d+)s", message)
    if retry_match:
        return min(75.0, float(retry_match.group(1)) + 1)
    retry_match = re.search(r"Please retry in ([\d.]+)ms", message)
    if retry_match:
        return min(75.0, float(retry_match.group(1)) / 1000 + 1)
    retry_match = re.search(r"Please retry in ([\d.]+)s\b", message)
    if retry_match:
        return min(75.0, float(retry_match.group(1)) + 1)
    if "429" in message or "RESOURCE_EXHAUSTED" in message:
        return 65.0
    if "503" in message or "UNAVAILABLE" in message:
        return 20.0
    if "500" in message or "INTERNAL" in message:
        return 20.0
    return None


def wave_info(path: Path):
    with wave.open(str(path), "rb") as clip:
        return clip.getparams(), clip.getnframes() / clip.getframerate()


def frame_count(seconds: float, framerate: int) -> int:
    return int(round(seconds * framerate))


def tempo_chain(tempo: float) -> str:
    values: list[float] = []
    while tempo < 0.5:
        values.append(0.5)
        tempo /= 0.5
    while tempo > 2.0:
        values.append(2.0)
        tempo /= 2.0
    values.append(tempo)
    return ",".join(f"atempo={value:.6f}" for value in values)


def convert_to_wav(source: Path, target: Path, ffmpeg: str) -> None:
    filters = (
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03:"
        "stop_periods=1:stop_threshold=-50dB:stop_silence=0.12,"
        "loudnorm=I=-21:LRA=7:TP=-2"
    )
    run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(source),
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-sample_fmt",
            "s16",
            "-af",
            filters,
            str(target),
        ]
    )


def write_pcm_wave(target: Path, pcm_data: bytes, sample_rate: int = SAMPLE_RATE) -> None:
    if pcm_data[:4] == b"RIFF":
        target.write_bytes(pcm_data)
        return
    with wave.open(str(target), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(pcm_data)


def inline_audio_bytes(response) -> bytes:
    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            inline_data = getattr(part, "inline_data", None)
            data = getattr(inline_data, "data", None)
            if not data:
                continue
            if isinstance(data, str):
                return base64.b64decode(data)
            return bytes(data)
    raise RuntimeError("Gemini response did not include inline audio data")


def gemini_prompt(text: str, style: str) -> str:
    if style == "box":
        return (
            "请用舒缓有力、均匀柔和、放松但清晰的普通话朗读。"
            f"只朗读下面这句，不要添加任何其他内容：{text}"
        )
    if style == "wim-count":
        return (
            "请用稳定、清晰、两秒一拍的普通话呼吸计数语气朗读。"
            f"只朗读这个中文数字或短句，不要添加其他内容：{text}"
        )
    return f"请用清晰自然的普通话只朗读下面内容：{text}"


def synthesize_gemini_segments(
    segments: list[str], directory: Path, prefix: str, *, style: str = "default"
) -> list[Path]:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("set GEMINI_API_KEY or GOOGLE_API_KEY to enable Gemini TTS")

    from google import genai
    from google.genai import types

    model = os.environ.get("GEMINI_TTS_MODEL", "gemini-2.5-pro-preview-tts")
    voice_name = os.environ.get("GEMINI_TTS_VOICE", "Kore")
    min_interval = float(os.environ.get("GEMINI_TTS_MIN_INTERVAL_SECONDS", "7.0"))
    client = genai.Client(api_key=api_key)
    config = types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=voice_name,
                )
            )
        ),
    )
    targets: list[Path] = []
    previous_request_at = 0.0
    for index, text in enumerate(segments):
        target = directory / f"{prefix}-{index:03d}-gemini.wav"
        audio_data = None
        for attempt in range(4):
            elapsed = time.monotonic() - previous_request_at
            if previous_request_at and elapsed < min_interval:
                time.sleep(min_interval - elapsed)
            previous_request_at = time.monotonic()
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=gemini_prompt(text, style),
                    config=config,
                )
                audio_data = inline_audio_bytes(response)
                break
            except Exception as error:
                retry_seconds = gemini_retry_seconds(error)
                if retry_seconds is None or attempt == 3:
                    raise
                print(
                    f"Gemini TTS segment {index + 1}/{len(segments)} "
                    f"({text}) needs retry; waiting {retry_seconds:.0f}s.",
                    flush=True,
                )
                time.sleep(retry_seconds)
        if audio_data is None:
            raise RuntimeError(f"Gemini TTS failed for segment {index + 1}: {text}")
        write_pcm_wave(target, audio_data)
        targets.append(target)
    return targets


def fit_clip(
    source: Path,
    target: Path,
    seconds: float,
    ffmpeg: str,
    *,
    stretch: bool,
) -> None:
    params, duration = wave_info(source)
    if stretch:
        filters = [
            tempo_chain(duration / seconds),
            f"apad=pad_dur={seconds:.3f}",
            f"atrim=end={seconds:.3f}",
        ]
    else:
        available = max(0.2, seconds - 0.18)
        filters = []
        if duration > available:
            filters.append(tempo_chain(duration / available))
        filters.extend([f"apad=pad_dur={seconds:.3f}", f"atrim=end={seconds:.3f}"])
    fade_out_start = max(0, seconds - 0.08)
    filters.extend(
        [
            "afade=t=in:st=0:d=0.05",
            f"afade=t=out:st={fade_out_start:.3f}:d=0.08",
        ]
    )
    run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(source),
            "-ac",
            str(params.nchannels),
            "-ar",
            str(params.framerate),
            "-sample_fmt",
            "s16",
            "-af",
            ",".join(filters),
            str(target),
        ]
    )
    enforce_duration(target, seconds)


def enforce_duration(path: Path, seconds: float) -> None:
    params, _ = wave_info(path)
    wanted = frame_count(seconds, params.framerate)
    with wave.open(str(path), "rb") as source:
        frames = source.readframes(wanted)
    current = len(frames) // (params.nchannels * params.sampwidth)
    if current < wanted:
        frames += b"\x00" * (wanted - current) * params.nchannels * params.sampwidth
    with wave.open(str(path), "wb") as target:
        target.setparams(params)
        target.writeframes(frames)


async def synthesize_edge_segments(
    segments: list[str],
    directory: Path,
    prefix: str,
    *,
    voice: str = "zh-CN-XiaoxiaoNeural",
    rate: str = "-45%",
    volume: str = "-8%",
) -> list[Path]:
    import edge_tts

    targets: list[Path] = []
    semaphore = asyncio.Semaphore(4)

    async def synthesize_one(index: int, text: str, target: Path) -> None:
        async with semaphore:
            for attempt in range(3):
                try:
                    communicate = edge_tts.Communicate(text, voice, rate=rate, volume=volume)
                    await communicate.save(str(target))
                    return
                except Exception:
                    if attempt == 2:
                        raise
                    await asyncio.sleep(1.5 * (attempt + 1))

    tasks = []
    for index, text in enumerate(segments):
        target = directory / f"{prefix}-{index:03d}.mp3"
        targets.append(target)
        tasks.append(synthesize_one(index, text, target))
    await asyncio.gather(*tasks)
    return targets


def synthesize_sapi_segments(
    segments: list[str], directory: Path, prefix: str, rate: int = -8
) -> list[Path]:
    targets = [directory / f"{prefix}-{index:03d}.wav" for index in range(len(segments))]
    rows = ",".join(
        "@{Path='%s';Text='%s'}"
        % (powershell_literal(str(target)), powershell_literal(text))
        for target, text in zip(targets, segments)
    )
    command = (
        "Add-Type -AssemblyName System.Speech;"
        "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
        f"$s.SelectVoice('Microsoft Huihui Desktop');$s.Rate={rate};"
        "$s.Volume=85;"
        f"$items=@({rows});"
        "foreach($item in $items){"
        "$s.SetOutputToWaveFile($item.Path);$s.Speak($item.Text);$s.SetOutputToNull()"
        "};$s.Dispose()"
    )
    encoded = base64.b64encode(command.encode("utf-16le")).decode("ascii")
    subprocess.run(["powershell", "-NoProfile", "-EncodedCommand", encoded], check=True)
    return targets


def synthesize_segments(
    segments: list[str], directory: Path, prefix: str, *, style: str = "default"
) -> list[Path]:
    unique_segments = list(dict.fromkeys(segments))
    unique_sources: list[Path | None] = [None] * len(unique_segments)
    gemini_available = True
    try:
        gemini_sources = synthesize_gemini_segments(
            unique_segments,
            directory,
            prefix,
            style=style,
        )
        unique_sources = list(gemini_sources)
    except Exception as error:
        print(
            "Gemini TTS batch was incomplete; retrying missing segments one by one: "
            f"{safe_error(error)}",
            flush=True,
        )
        if gemini_daily_quota_exhausted(error):
            gemini_available = False
        for index in range(len(unique_segments)):
            expected = directory / f"{prefix}-{index:03d}-gemini.wav"
            if expected.exists():
                unique_sources[index] = expected

    min_interval = float(os.environ.get("GEMINI_TTS_MIN_INTERVAL_SECONDS", "7.0"))
    for index, text in enumerate(unique_segments):
        if unique_sources[index] is not None:
            continue
        if not gemini_available:
            print(
                f"Gemini TTS quota is exhausted; falling back for segment "
                f"{index + 1}/{len(unique_segments)}.",
                flush=True,
            )
        elif index:
            time.sleep(min_interval)
        if gemini_available:
            try:
                unique_sources[index] = synthesize_gemini_segments(
                    [text],
                    directory,
                    f"{prefix}-{index:03d}-retry",
                    style=style,
                )[0]
                continue
            except Exception as error:
                if gemini_daily_quota_exhausted(error):
                    gemini_available = False
                print(
                    f"Gemini TTS segment {index + 1}/{len(unique_segments)} "
                    f"still failed; falling back for this segment only: {safe_error(error)}",
                    flush=True,
                )
        try:
            unique_sources[index] = asyncio.run(
                synthesize_edge_segments([text], directory, f"{prefix}-{index:03d}-edge")
            )[0]
        except Exception as edge_error:
            print(
                "Edge TTS unavailable for one segment, falling back to Windows SAPI: "
                f"{safe_error(edge_error)}",
                flush=True,
            )
            unique_sources[index] = synthesize_sapi_segments(
                [text], directory, f"{prefix}-{index:03d}-sapi"
            )[0]

    resolved_sources = [source for source in unique_sources if source is not None]
    if len(resolved_sources) != len(unique_segments):
        raise RuntimeError("Could not synthesize every segment")
    source_by_text = dict(zip(unique_segments, resolved_sources))
    return [source_by_text[text] for text in segments]


def prepare_clips(
    sources: list[Path],
    directory: Path,
    prefix: str,
    seconds: float,
    ffmpeg: str,
    *,
    stretch: bool,
) -> list[Path]:
    clips: list[Path] = []
    cache: dict[Path, Path] = {}
    for index, source in enumerate(sources):
        if source in cache:
            clips.append(cache[source])
            continue
        converted = directory / f"{prefix}-{index:03d}-converted.wav"
        fitted = directory / f"{prefix}-{index:03d}-fitted.wav"
        if source.suffix.lower() == ".wav":
            convert_to_wav(source, converted, ffmpeg)
        else:
            convert_to_wav(source, converted, ffmpeg)
        fit_clip(converted, fitted, seconds, ffmpeg, stretch=stretch)
        cache[source] = fitted
        clips.append(fitted)
    return clips


def export_segment_wavs(sources: list[Path], directory: Path, ffmpeg: str) -> list[Path]:
    wavs: list[Path] = []
    for index, source in enumerate(sources):
        target = directory / f"{audio_stem(index)}.wav"
        convert_to_wav(source, target, ffmpeg)
        wavs.append(target)
    return wavs


def write_exact_clip(destination: wave.Wave_write, source: Path, seconds: float) -> None:
    params = destination.getparams()
    wanted = frame_count(seconds, params.framerate)
    with wave.open(str(source), "rb") as clip:
        clip_params = clip.getparams()
        if (
            clip_params.nchannels != params.nchannels
            or clip_params.sampwidth != params.sampwidth
            or clip_params.framerate != params.framerate
            or clip_params.comptype != params.comptype
        ):
            raise RuntimeError("Speech segments use incompatible wave formats")
        frames = clip.readframes(wanted)
    current = len(frames) // (params.nchannels * params.sampwidth)
    if current < wanted:
        frames += b"\x00" * (wanted - current) * params.nchannels * params.sampwidth
    destination.writeframes(frames)


def write_silence(destination: wave.Wave_write, seconds: float) -> None:
    params = destination.getparams()
    destination.writeframes(
        b"\x00"
        * frame_count(seconds, params.framerate)
        * params.nchannels
        * params.sampwidth
    )


def write_silence_with_overlays(
    destination: wave.Wave_write, seconds: float, overlays: list[dict]
) -> None:
    params = destination.getparams()
    if params.sampwidth != 2:
        raise RuntimeError("Overlay mixing expects 16-bit PCM wave output")

    total_frames = frame_count(seconds, params.framerate)
    bytes_per_frame = params.nchannels * params.sampwidth
    mixed = bytearray(total_frames * bytes_per_frame)

    for overlay in overlays:
        source = overlay["source"]
        offset_frames = frame_count(float(overlay.get("offset", 0)), params.framerate)
        volume = float(overlay.get("volume", 1.0))
        with wave.open(str(source), "rb") as clip:
            clip_params = clip.getparams()
            if (
                clip_params.nchannels != params.nchannels
                or clip_params.sampwidth != params.sampwidth
                or clip_params.framerate != params.framerate
            ):
                raise RuntimeError("Overlay clip uses incompatible wave format")
            overlay_bytes = clip.readframes(total_frames)
        max_bytes = max(0, len(mixed) - offset_frames * bytes_per_frame)
        overlay_bytes = overlay_bytes[:max_bytes]
        start = offset_frames * bytes_per_frame
        for index in range(0, len(overlay_bytes), params.sampwidth):
            target_index = start + index
            source_sample = int.from_bytes(
                overlay_bytes[index : index + 2], "little", signed=True
            )
            target_sample = int.from_bytes(
                mixed[target_index : target_index + 2], "little", signed=True
            )
            value = max(-32768, min(32767, target_sample + int(source_sample * volume)))
            mixed[target_index : target_index + 2] = int(value).to_bytes(
                2, "little", signed=True
            )
    destination.writeframes(bytes(mixed))


def combine_slots(parts: list[dict], output: Path) -> list[dict]:
    first_source = None
    for part in parts:
        if part.get("source"):
            first_source = part["source"]
            break
        for overlay in part.get("overlays", []):
            first_source = overlay["source"]
            break
        if first_source:
            break
    if first_source is None:
        raise RuntimeError("No audio source was provided for slot combination")
    params, _ = wave_info(first_source)
    cues: list[dict] = []
    elapsed_frames = 0

    with wave.open(str(output), "wb") as destination:
        destination.setparams(params)
        for part in parts:
            duration = float(part["duration"])
            start = elapsed_frames / params.framerate
            if part.get("source"):
                write_exact_clip(destination, part["source"], duration)
            elif part.get("overlays"):
                write_silence_with_overlays(destination, duration, part["overlays"])
            else:
                write_silence(destination, duration)
            elapsed_frames += frame_count(duration, params.framerate)
            end = elapsed_frames / params.framerate
            cue = {
                "start": round(start, 3),
                "end": round(end, 3),
                "label": part["label"],
                "scale": part.get("scale", 1),
                "group": part.get("group"),
                "step": part.get("step"),
            }
            if part.get("countdown"):
                cue["countdown"] = True
            if part.get("beats"):
                cue["beats"] = [round(start + float(offset), 3) for offset in part["beats"]]
            cues.append(cue)
    return cues


def build_box_parts(clips: list[Path], muyu_hit: Path | None = None) -> list[dict]:
    parts: list[dict] = []
    for source, (text, scale) in zip(clips, BOX_SEGMENTS):
        narration_overlays = [
            {"source": source, "offset": BOX_VOICE_OFFSET_SECONDS, "volume": 1.0}
        ]
        if muyu_hit:
            narration_overlays.insert(0, {"source": muyu_hit, "offset": 0, "volume": 0.46})
        parts.append(
            {
                "duration": BOX_SPEECH_SECONDS,
                "label": text,
                "scale": scale,
                "step": "narration",
                "overlays": narration_overlays,
                "beats": [0.0] if muyu_hit else [],
            }
        )
        hold = {
            "duration": BOX_SILENCE_SECONDS,
            "label": "· · · ·",
            "scale": scale,
            "step": "hold",
            "countdown": True,
        }
        if muyu_hit:
            hold["overlays"] = [{"source": muyu_hit, "offset": 0, "volume": 0.46}]
            hold["beats"] = [0.0]
        parts.append(hold)
    return parts


def clamp_sample(value: int) -> int:
    return max(-32768, min(32767, value))


def add_brainwave_bed(source: Path, target: Path) -> None:
    with wave.open(str(source), "rb") as input_wave:
        params = input_wave.getparams()
        if params.nchannels != 1 or params.sampwidth != 2:
            raise RuntimeError("Brainwave mix expects a mono 16-bit PCM wave source")
        samples = input_wave.readframes(params.nframes)

    total_frames = len(samples) // 2
    fade_frames = max(1, frame_count(1.6, params.framerate))
    stereo = bytearray(total_frames * 4)
    alpha_amp = int(32767 * 0.011)
    theta_amp = int(32767 * 0.008)
    for frame in range(total_frames):
        sample = int.from_bytes(samples[frame * 2 : frame * 2 + 2], "little", signed=True)
        t = frame / params.framerate
        fade = min(1.0, frame / fade_frames, (total_frames - frame) / fade_frames)
        voice = int(sample * 0.96)
        left_bed = fade * (
            alpha_amp * math.sin(2 * math.pi * 215 * t)
            + theta_amp * math.sin(2 * math.pi * 171 * t)
        )
        right_bed = fade * (
            alpha_amp * math.sin(2 * math.pi * 225 * t)
            + theta_amp * math.sin(2 * math.pi * 177 * t)
        )
        offset = frame * 4
        stereo[offset : offset + 2] = int(clamp_sample(voice + int(left_bed))).to_bytes(
            2, "little", signed=True
        )
        stereo[offset + 2 : offset + 4] = int(
            clamp_sample(voice + int(right_bed))
        ).to_bytes(2, "little", signed=True)

    with wave.open(str(target), "wb") as output_wave:
        output_wave.setnchannels(2)
        output_wave.setsampwidth(2)
        output_wave.setframerate(params.framerate)
        output_wave.writeframes(bytes(stereo))


def export_deliverables(wav_source: Path, ffmpeg: str) -> None:
    mp3_target = wav_source.with_suffix(".mp3")
    pcm_target = wav_source.with_suffix(".pcm")
    run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(wav_source),
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "192k",
            str(mp3_target),
        ]
    )
    run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(wav_source),
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            "-ar",
            str(SAMPLE_RATE),
            "-ac",
            "2",
            str(pcm_target),
        ]
    )


def build_wim_texts() -> list[str]:
    texts = ["请保持坐姿或躺姿"]
    for group in range(1, 4):
        texts.append(f"下面开始第{CHINESE_NUMBERS[group - 1]}组")
        texts.extend(CHINESE_NUMBERS)
        texts.extend(["现在闭气六十秒", "现在深吸憋气十五秒", "现在大口呼出"])
    return texts


def build_wim_parts(clips: list[Path]) -> list[dict]:
    parts: list[dict] = []
    source_index = 0
    for group in range(1, 4):
        if group == 1:
            parts.append(
                {
                    "source": clips[source_index],
                    "duration": PREPARE_SECONDS,
                    "label": "保持坐姿或躺姿",
                    "scale": 1,
                    "group": group,
                    "step": "prepare",
                }
            )
            source_index += 1
        parts.append(
            {
                "source": clips[source_index],
                "duration": PREPARE_SECONDS,
                "label": f"第{CHINESE_NUMBERS[group - 1]}组开始",
                "scale": 1,
                "group": group,
                "step": "prepare",
            }
        )
        source_index += 1
        for count in range(1, len(CHINESE_NUMBERS) + 1):
            parts.append(
                {
                    "source": clips[source_index],
                    "duration": WIM_COUNT_SECONDS,
                    "label": f"爆发深呼吸 {count} / 30",
                    "scale": 1.18 if count % 2 else 0.88,
                    "group": group,
                    "step": "breathe",
                }
            )
            source_index += 1
        parts.extend(
            [
                {
                    "source": clips[source_index],
                    "duration": PROMPT_SECONDS,
                    "label": "闭气六十秒",
                    "scale": 0.9,
                    "group": group,
                    "step": "prompt",
                },
                {
                    "duration": 60,
                    "label": "闭气六十秒",
                    "scale": 0.9,
                    "group": group,
                    "step": "hold",
                    "countdown": True,
                },
                {
                    "source": clips[source_index + 1],
                    "duration": PROMPT_SECONDS,
                    "label": "深吸憋气十五秒",
                    "scale": 1.2,
                    "group": group,
                    "step": "prompt",
                },
                {
                    "duration": 15,
                    "label": "深吸憋气十五秒",
                    "scale": 1.2,
                    "group": group,
                    "step": "hold",
                    "countdown": True,
                },
                {
                    "source": clips[source_index + 2],
                    "duration": PROMPT_SECONDS,
                    "label": "大口呼出",
                    "scale": 0.84,
                    "group": group,
                    "step": "exhale",
                },
            ]
        )
        source_index += 3
    return parts


def extract_muyu_hit(directory: Path, ffmpeg: str) -> Path | None:
    source = OUTPUT_DIR / "muyu.mp3"
    if not source.exists():
        print(f"Skipping wooden fish overlay; {source} was not found.", flush=True)
        return None
    target = directory / "muyu-hit.wav"
    filters = (
        "silenceremove=start_periods=1:start_threshold=-46dB:start_silence=0.02,"
        "atrim=end=0.72,asetpts=N/SR/TB,"
        "afade=t=in:st=0:d=0.01,afade=t=out:st=0.58:d=0.14,"
        "loudnorm=I=-26:LRA=5:TP=-4"
    )
    run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(source),
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-sample_fmt",
            "s16",
            "-af",
            filters,
            str(target),
        ]
    )
    return target


def verify_timeline(cue_data: dict) -> None:
    box_cues = cue_data["box"]["cues"]
    for index, cue in enumerate(box_cues):
        expected = BOX_SPEECH_SECONDS if cue["step"] == "narration" else BOX_SILENCE_SECONDS
        actual = cue["end"] - cue["start"]
        if not math.isclose(actual, expected, abs_tol=0.001):
            raise RuntimeError(f"Box cue {index} is {actual:.3f}s, expected {expected:.3f}s")

    for group in range(1, 4):
        wim_counts = [
            cue
            for cue in cue_data["wim"]["cues"]
            if cue.get("step") == "breathe" and cue.get("group") == group
        ]
        intervals = [
            round(wim_counts[i + 1]["start"] - wim_counts[i]["start"], 3)
            for i in range(len(wim_counts) - 1)
        ]
        for interval in intervals:
            if not math.isclose(interval, WIM_COUNT_SECONDS, abs_tol=0.001):
                raise RuntimeError(f"Wim group {group} count interval is {interval:.3f}s")


def generate() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ffmpeg = ffmpeg_path()
    kind = os.environ.get("GENERATE_AUDIO_KIND", "all").lower()
    if kind not in {"all", "box", "wim"}:
        raise RuntimeError("GENERATE_AUDIO_KIND must be all, box, or wim")
    cue_path = OUTPUT_DIR / "breathing_cues.json"
    existing_cues = {}
    if cue_path.exists():
        existing_cues = json.loads(cue_path.read_text(encoding="utf-8"))
    box_cues = existing_cues.get("box", {}).get("cues")
    wim_cues = existing_cues.get("wim", {}).get("cues")
    box_metadata = existing_cues.get("box", {})
    wim_metadata = existing_cues.get("wim", {})

    with tempfile.TemporaryDirectory(prefix="deepstudy-audio-") as temp:
        temp_dir = Path(temp)

        if kind in {"all", "box"}:
            print("Generating 4-4-4-4 breathing guide...", flush=True)
            muyu_hit = extract_muyu_hit(temp_dir, ffmpeg)
            box_texts = [text for text, _ in BOX_SEGMENTS]
            segment_dir = OUTPUT_DIR / "box_4444_minimax" / "segments"
            if os.environ.get("MINIMAX_API_KEY"):
                box_sources = synthesize_minimax_segments(box_texts, segment_dir)
                box_sources = export_segment_wavs(box_sources, segment_dir, ffmpeg)
            elif os.environ.get("REQUIRE_MINIMAX_TTS", "0") == "1":
                raise RuntimeError("MINIMAX_API_KEY is required when REQUIRE_MINIMAX_TTS=1")
            else:
                box_sources = synthesize_segments(
                    box_texts,
                    temp_dir,
                    "box",
                    style="box",
                )
            box_clips = prepare_clips(
                box_sources,
                temp_dir,
                "box",
                BOX_VOICE_SECONDS,
                ffmpeg,
                stretch=False,
            )
            base_box_output = temp_dir / "breathing_guide_voice_muyu.wav"
            final_box_output = OUTPUT_DIR / "breathing_guide.wav"
            box_cues = combine_slots(
                build_box_parts(box_clips, muyu_hit),
                base_box_output,
            )
            add_brainwave_bed(base_box_output, final_box_output)
            export_deliverables(final_box_output, ffmpeg)
            box_metadata = {
                "playbackRate": 1,
                "embeddedBrainwave": True,
                "voiceOffsetSeconds": BOX_VOICE_OFFSET_SECONDS,
                "cues": box_cues,
            }

        if kind in {"all", "wim"}:
            print("Generating Wim Hof breathing guide...", flush=True)
            wim_texts = build_wim_texts()
            wim_sources = synthesize_segments(wim_texts, temp_dir, "wim", style="wim-count")
            wim_clips = prepare_clips(
                wim_sources,
                temp_dir,
                "wim",
                WIM_COUNT_SECONDS,
                ffmpeg,
                stretch=True,
            )
            wim_cues = combine_slots(build_wim_parts(wim_clips), OUTPUT_DIR / "wim_hof_guide.wav")
            wim_metadata = {"playbackRate": 1, "cues": wim_cues}

    if box_cues is None or wim_cues is None:
        raise RuntimeError("Requested partial generation but existing cues are incomplete")

    cue_data = {
        "box": {**box_metadata, "playbackRate": 1, "cues": box_cues},
        "wim": {**wim_metadata, "playbackRate": 1, "cues": wim_cues},
    }
    verify_timeline(cue_data)
    cue_path.write_text(
        json.dumps(cue_data, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"Generated {OUTPUT_DIR / 'breathing_guide.wav'}")
    print(f"Generated {OUTPUT_DIR / 'wim_hof_guide.wav'}")
    print(f"Generated {OUTPUT_DIR / 'breathing_cues.json'}")


if __name__ == "__main__":
    generate()
