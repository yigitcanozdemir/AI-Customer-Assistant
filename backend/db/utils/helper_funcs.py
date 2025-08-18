from pathlib import Path


def directory_exists(file_path: str):
    Path(file_path).parent.mkdir(parents=True, exist_ok=True)


def prettify(name: str) -> str:
    return " ".join(
        word[0].upper() + word[1:] if word else "" for word in name.split("_")
    )
