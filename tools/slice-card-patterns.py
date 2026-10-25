"""Crop image_gen card-pattern atlases without repainting, resampling, or alpha edits.

Without --verify, write fifteen exact 3:4 rectangular crops and their provenance.
With --verify, only read files: compare every decoded source/crop pixel,
check provenance, and verify fifteen distinct fully opaque patterns.
"""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image


LAYOUT = (
    ("card-patterns-01.png", ("brush", "talisman", "chain")),
    ("card-patterns-02.png", ("vow", "step", "coin")),
    ("card-patterns-03.png", ("fire", "bell", "seal")),
    ("card-patterns-04.png", ("lotus", "blood", "ledger")),
    ("card-patterns-05.png", ("mirror", "ferry", "verdict")),
)
METADATA = "card-pattern-slices.json"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check_png(image, filename, modes=("RGB", "RGBA")):
    require(image.format == "PNG", f"{filename}: expected a real PNG file.")
    require(image.mode in modes, f"{filename}: expected {'/'.join(modes)}, got {image.mode}; no conversion is performed.")
    image.load()


def opaque_pixel_hash(image, filename):
    """Hash visible RGB pixels identically for RGB and fully opaque RGBA files."""
    if image.mode == "RGBA":
        minimum, maximum = image.getchannel("A").getextrema()
        require(minimum == maximum == 255, f"{filename}: pattern must be fully opaque, alpha range is {minimum}..{maximum}.")
    digest = hashlib.sha256()
    digest.update(f"{image.width}x{image.height}:RGB".encode("ascii"))
    # Reading channels only normalizes the hash; crop files retain source mode.
    for channel in ("R", "G", "B"):
        digest.update(image.getchannel(channel).tobytes())
    return digest.hexdigest()


def collect_crops(root):
    sources = []
    assets = []
    crops = []
    for filename, names in LAYOUT:
        with Image.open(root / filename) as source:
            check_png(source, filename)
            require(source.width * 4 == source.height * 9 and source.width % 3 == 0, f"{filename}: expected three gapless 3:4 cells in a 9:4 atlas, got {source.size}.")
            cell_width = source.width // 3
            cell_height = source.height
            sources.append({"filename": filename, "size": list(source.size), "mode": source.mode})
            for column, name in enumerate(names):
                left = column * cell_width
                output = f"card-pattern-{name}.png"
                record = {"filename": output, "source": filename, "crop": [left, 0, cell_width, cell_height], "size": [cell_width, cell_height]}
                assets.append(record)
                crops.append((record, source.crop((left, 0, left + cell_width, cell_height))))
    return {"version": 1, "operation": "crop-only", "sources": sources, "assets": assets}, crops


def verify(root, metadata, crops):
    saved = json.loads((root / METADATA).read_text(encoding="utf-8"))
    require(saved == metadata, f"{METADATA}: provenance differs from the current source dimensions/crop rectangles.")
    hashes = {}
    for record, expected in crops:
        filename = record["filename"]
        with Image.open(root / filename) as actual:
            check_png(actual, filename)
            require(actual.mode == expected.mode, f"{filename}: mode changed from source {expected.mode} to {actual.mode}.")
            require(actual.size == expected.size, f"{filename}: size differs from its source crop.")
            require(actual.width * 4 == actual.height * 3, f"{filename}: expected natural 3:4 proportions.")
            require(actual.tobytes() == expected.tobytes(), f"{filename}: pixels changed beyond rectangular cropping.")
            digest = opaque_pixel_hash(actual, filename)
            require(digest not in hashes, f"{filename}: duplicates pattern pixels from {hashes.get(digest)}.")
            hashes[digest] = filename
            print(f"{filename}: exact {actual.mode} 3:4 crop, fully opaque, sha256 {digest}")
    require(len(hashes) == 15, "Expected fifteen distinct card patterns.")
    print("Verified 15 distinct opaque source-pattern crops and provenance; no files written.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets-root", type=Path, default=Path(__file__).resolve().parents[1] / "game" / "public" / "assets")
    parser.add_argument("--verify", action="store_true", help="Read only: compare all crop pixels/provenance and verify pattern opacity.")
    args = parser.parse_args()
    try:
        require(args.assets_root.is_dir(), f"Assets directory does not exist: {args.assets_root}")
        metadata, crops = collect_crops(args.assets_root)
        if args.verify:
            verify(args.assets_root, metadata, crops)
        else:
            # Validate every source layout before writing. No image resizing,
            # color conversion, masking, painting, or alpha changes occur.
            for record, crop in crops:
                crop.save(args.assets_root / record["filename"], format="PNG")
            (args.assets_root / METADATA).write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"Wrote {len(crops)} unmodified 3:4 rectangular crops and {METADATA}.")
    except (OSError, ValueError) as error:
        parser.exit(1, f"error: {error}\n")


if __name__ == "__main__":
    main()
