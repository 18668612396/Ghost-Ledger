"""Only crop rectangular cells from the image_gen atlas; never repaint or alter alpha."""
import argparse
import json
from pathlib import Path

from PIL import Image

NAMES = ("brush", "talisman", "chain", "step", "fire", "bell", "seal", "coin", "lotus")
SOURCE = "card-art-cutouts.png"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets-root", type=Path, default=Path(__file__).resolve().parents[1] / "game" / "public" / "assets")
    parser.add_argument("--verify", action="store_true", help="Read only: compare crops and verify real transparent backgrounds.")
    args = parser.parse_args()
    root = args.assets_root
    source = Image.open(root / SOURCE)
    assert source.mode == "RGBA", "The generated atlas must retain its original RGBA alpha."
    assert source.width == source.height and source.width % 3 == 0, "Expected a square 3x3 atlas."
    side = source.width // 3
    records = []
    for index, name in enumerate(NAMES):
        left, top = index % 3 * side, index // 3 * side
        rectangle = (left, top, left + side, top + side)
        filename = f"card-art-{name}.png"
        crop = source.crop(rectangle)
        record = {"filename": filename, "source": SOURCE, "crop": [left, top, side, side], "size": [side, side]}
        records.append(record)
        if args.verify:
            actual = Image.open(root / filename)
            assert actual.mode == "RGBA" and actual.size == crop.size
            assert actual.tobytes() == crop.tobytes(), f"{filename}: pixels were changed beyond cropping."
            alpha = actual.getchannel("A")
            transparent = alpha.histogram()[0] / (side * side)
            assert transparent > 0.30, f"{filename}: illustration has too little genuine transparent space."
            assert max(alpha.getpixel(point) for point in ((0, 0), (side - 1, 0), (0, side - 1), (side - 1, side - 1))) == 0
            print(f"{filename}: exact crop, {transparent:.1%} alpha-zero pixels")
        else:
            crop.save(root / filename)

    metadata = {"version": 1, "operation": "crop-only", "source": SOURCE, "sourceSize": list(source.size), "assets": records}
    if args.verify:
        assert json.loads((root / "card-art-slices.json").read_text(encoding="utf-8")) == metadata
        for name in ("mirror", "ledger"):
            illustration = Image.open(root / f"card-art-{name}.png")
            assert illustration.mode == "RGBA" and illustration.width == illustration.height
            alpha = illustration.getchannel("A")
            assert alpha.histogram()[0] / (illustration.width * illustration.height) > 0.30
            assert alpha.getpixel((0, 0)) == 0
        print("9 exact atlas crops and 2 standalone transparent illustrations verified; no files written.")
    else:
        (root / "card-art-slices.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
