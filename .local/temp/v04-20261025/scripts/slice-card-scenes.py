"""Crop image_gen card-background atlases without repainting, resampling, or alpha edits.

Without --verify, write the fifteen exact rectangular crops and their provenance.
With --verify, only read files: compare every decoded source/crop pixel, check
unique opaque backgrounds, and inspect the generated frame and cost badge alpha.
"""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image


LAYOUT = (
    ("card-scenes-01.png", ("brush", "talisman", "chain")),
    ("card-scenes-02.png", ("vow", "step", "coin")),
    ("card-scenes-03.png", ("fire", "bell", "seal")),
    ("card-scenes-04.png", ("lotus", "blood", "ledger")),
    ("card-scenes-05.png", ("mirror", "ferry", "verdict")),
)
METADATA = "card-scene-slices.json"

# Interior paper areas, away from the generated ornamental edges. Coordinates
# are fractions of the natural 2:3 frame, never a request to resize its pixels.
TITLE_PAPER = (0.30, 0.06, 0.75, 0.11)
RULES_PAPER = (0.20, 0.74, 0.80, 0.88)
WINDOW_CENTER = (0.50, 0.42)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check_png(image, filename, modes=("RGB", "RGBA")):
    require(image.format == "PNG", f"{filename}: expected a real PNG file.")
    require(image.mode in modes, f"{filename}: expected {'/'.join(modes)}, got {image.mode}; no conversion is performed.")
    image.load()


def corners(image):
    return ((0, 0), (image.width - 1, 0), (0, image.height - 1), (image.width - 1, image.height - 1))


def fractional_rectangle(image, fractions):
    left, top, right, bottom = fractions
    rectangle = (int(image.width * left), int(image.height * top), int(image.width * right), int(image.height * bottom))
    require(rectangle[2] > rectangle[0] and rectangle[3] > rectangle[1], "Image is too small for alpha verification regions.")
    return rectangle


def opaque_pixel_hash(image, filename):
    """Hash visible RGB pixels identically for RGB and fully opaque RGBA files."""
    if image.mode == "RGBA":
        minimum, maximum = image.getchannel("A").getextrema()
        require(minimum == maximum == 255, f"{filename}: background must be fully opaque, alpha range is {minimum}..{maximum}.")
    digest = hashlib.sha256()
    digest.update(f"{image.width}x{image.height}:RGB".encode("ascii"))
    # Channel reads are inspection only; the saved crop keeps its source mode.
    for channel in ("R", "G", "B"):
        digest.update(image.getchannel(channel).tobytes())
    return digest.hexdigest()


def verify_frame(root):
    filename = "card-frame-wash.png"
    with Image.open(root / filename) as frame:
        check_png(frame, filename, ("RGBA",))
        require(frame.width * 3 == frame.height * 2, f"{filename}: expected natural 2:3 proportions, got {frame.size}.")
        alpha = frame.getchannel("A")
        require(all(alpha.getpixel(point) == 0 for point in corners(frame)), f"{filename}: all four outside corners must have alpha 0.")
        point = (int(frame.width * WINDOW_CENTER[0]), int(frame.height * WINDOW_CENTER[1]))
        require(alpha.getpixel(point) == 0, f"{filename}: illustration-window center {point} must have alpha 0.")
        for label, region in (("title", TITLE_PAPER), ("rules", RULES_PAPER)):
            rectangle = fractional_rectangle(frame, region)
            minimum = alpha.crop(rectangle).getextrema()[0]
            require(minimum >= 250, f"{filename}: {label} paper body {rectangle} must remain opaque (alpha >= 250), got {minimum}.")
        print(f"{filename}: 2:3 frame, opaque title/rules paper, transparent window and outside corners")


def verify_cost_badge(root):
    filename = "card-cost-spirit.png"
    with Image.open(root / filename) as badge:
        check_png(badge, filename, ("RGBA",))
        require(badge.width == badge.height, f"{filename}: expected square proportions, got {badge.size}.")
        alpha = badge.getchannel("A")
        require(all(alpha.getpixel(point) == 0 for point in corners(badge)), f"{filename}: all four outside corners must have alpha 0.")
        center = (badge.width // 2, badge.height // 2)
        require(alpha.getpixel(center) >= 250, f"{filename}: the center must remain opaque (alpha >= 250).")
        print(f"{filename}: square badge, opaque center, transparent outside corners")


def collect_crops(root):
    sources = []
    assets = []
    crops = []
    for filename, names in LAYOUT:
        with Image.open(root / filename) as source:
            check_png(source, filename)
            require(source.width == source.height * 3, f"{filename}: expected three gapless square cells in a 3:1 atlas, got {source.size}.")
            side = source.height
            sources.append({"filename": filename, "size": list(source.size), "mode": source.mode})
            for column, name in enumerate(names):
                left = column * side
                output = f"card-bg-{name}.png"
                record = {"filename": output, "source": filename, "crop": [left, 0, side, side], "size": [side, side]}
                assets.append(record)
                crops.append((record, source.crop((left, 0, left + side, side))))
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
            require(actual.tobytes() == expected.tobytes(), f"{filename}: pixels changed beyond rectangular cropping.")
            digest = opaque_pixel_hash(actual, filename)
            require(digest not in hashes, f"{filename}: duplicates background pixels from {hashes.get(digest)}.")
            hashes[digest] = filename
            print(f"{filename}: exact {actual.mode} crop, fully opaque, sha256 {digest}")
    require(len(hashes) == 15, "Expected fifteen distinct card backgrounds.")
    verify_frame(root)
    verify_cost_badge(root)
    print("Verified 15 distinct opaque backgrounds, one frame and one cost badge; no files written.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets-root", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "assets")
    parser.add_argument("--verify", action="store_true", help="Read only: compare all pixels/provenance and verify opacity and frame/badge alpha.")
    args = parser.parse_args()
    try:
        require(args.assets_root.is_dir(), f"Assets directory does not exist: {args.assets_root}")
        metadata, crops = collect_crops(args.assets_root)
        if args.verify:
            verify(args.assets_root, metadata, crops)
        else:
            # Validate all five source layouts before writing any output. The
            # only image operation producing art is the exact crop above.
            for record, crop in crops:
                crop.save(args.assets_root / record["filename"], format="PNG")
            (args.assets_root / METADATA).write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"Wrote {len(crops)} unmodified rectangular crops and {METADATA}.")
    except (OSError, ValueError) as error:
        parser.exit(1, f"error: {error}\n")


if __name__ == "__main__":
    main()
