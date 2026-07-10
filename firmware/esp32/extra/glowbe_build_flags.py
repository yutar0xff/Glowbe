"""Inject firmware build flags from glowbe.firmware.env and the shell environment."""

import os

Import("env")  # type: ignore[name-defined]  # PlatformIO SCons

DEFAULT_MAX_CURRENT_MA = 3200
ENV_FILE_NAME = "glowbe.firmware.env"


def _parse_env_line(line: str) -> tuple[str, str] | None:
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    if line.startswith("export "):
        line = line[7:].strip()
    if "=" not in line:
        return None
    key, value = line.split("=", 1)
    key = key.strip()
    value = value.strip().strip('"').strip("'")
    if not key:
        return None
    return key, value


def _apply_env_file(path: str) -> None:
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            parsed = _parse_env_line(line)
            if parsed is None:
                continue
            key, value = parsed
            if key not in os.environ:
                os.environ[key] = value


def _max_current_ma() -> int:
    project_dir = env.subst("$PROJECT_DIR")
    _apply_env_file(os.path.join(project_dir, ENV_FILE_NAME))
    raw = os.environ.get("GLOWBE_MAX_CURRENT_MA", str(DEFAULT_MAX_CURRENT_MA))
    try:
        ma = int(raw)
        if ma <= 0:
            raise ValueError("must be positive")
        return ma
    except ValueError:
        print(f"warning: invalid GLOWBE_MAX_CURRENT_MA={raw!r}, using {DEFAULT_MAX_CURRENT_MA}")
        return DEFAULT_MAX_CURRENT_MA


_ma = _max_current_ma()
print(f"glowbe build: GLOWBE_MAX_CURRENT_MA={_ma}")
env.Append(CPPDEFINES=[("GLOWBE_MAX_CURRENT_MA", _ma)])
