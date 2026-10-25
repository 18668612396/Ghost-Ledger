"""User-authorized color grading of existing image_gen PNGs; no drawing or regeneration."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

FAMILIES = {
    "strike": {"label": "攻伐", "hue": 10, "cards": ["brush", "coin", "fire"], "frameSource": "card-frame-muted-attack.png"},
    "ward": {"label": "护身", "hue": 154, "cards": ["talisman", "step", "lotus", "mirror"], "frameSource": "card-frame-muted-skill.png"},
    "spirit": {"label": "灵术", "hue": 212, "cards": ["bell", "ledger", "ferry"], "frameSource": "card-frame-muted-skill.png"},
    "oath": {"label": "阴契", "hue": 285, "cards": ["chain", "vow", "seal", "blood", "verdict"], "frameSource": "card-frame-muted-attack.png"},
}
RECORD = "card-color-adjustments.json"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rgb_to_hsv(rgb):
    maximum = rgb.max(axis=-1)
    minimum = rgb.min(axis=-1)
    delta = maximum - minimum
    saturation = np.divide(delta, maximum, out=np.zeros_like(delta), where=maximum > 0)
    hue = np.zeros_like(maximum)
    divisor = np.where(delta > 0, delta, 1)
    dominant = rgb.argmax(axis=-1)
    candidates = ((rgb[..., 1] - rgb[..., 2]) / divisor,
                  (rgb[..., 2] - rgb[..., 0]) / divisor + 2,
                  (rgb[..., 0] - rgb[..., 1]) / divisor + 4)
    for index, candidate in enumerate(candidates):
        hue = np.where((dominant == index) & (delta > 0), candidate, hue)
    return (hue / 6) % 1, saturation, maximum


def hsv_to_rgb(hue, saturation, value):
    sectors = (hue[..., None] * 6 + np.array([5, 3, 1], dtype=np.float32)) % 6
    ramps = np.clip(np.minimum(sectors, 4 - sectors), 0, 1)
    return value[..., None] * (1 - saturation[..., None] * ramps)


def grade(source, recipe):
    original = np.asarray(source)
    rgb = original[..., :3].astype(np.float32) / 255
    hue, saturation, value = rgb_to_hsv(rgb)
    if recipe["kind"] == "frame":
        # Existing colored rim pixels carry the type tint; bright paper and
        # achromatic ink retain their original hue. No geometric mask is drawn.
        weight = np.clip((saturation - 0.05) / 0.13, 0, 1) * np.clip((0.94 - value) / 0.20, 0, 1)
        new_saturation = np.clip(saturation * recipe["saturationMultiplier"] + weight * 0.16, 0, recipe["saturationCap"])
        # A color-selection adjustment on the existing title paper, not a new
        # painted shape: retain its pixels, ink, shading and exact alpha.
        title = np.arange(source.height)[:, None] < source.height * recipe["titleHeightFraction"]
        paper = title & (value > 0.72) & (saturation < 0.42)
        weight = np.where(paper, np.maximum(weight, 0.94), weight)
        new_saturation = np.where(paper, np.clip(new_saturation, 0.18, 0.29), new_saturation)
    else:
        # Grade existing watercolor pigments, retaining pale gold light flecks.
        accent = ((hue > 30 / 360) & (hue < 70 / 360) & (value > 0.72) & (saturation > 0.16))
        weight = np.clip(0.70 + saturation * 0.45, 0, 0.95) * np.where(accent, 0.24, 1)
        new_saturation = np.clip(saturation * recipe["saturationMultiplier"] + (1 - value) * 0.035, 0, recipe["saturationCap"])
    target = recipe["targetHueDegrees"] / 360
    delta = (target - hue + 0.5) % 1 - 0.5
    new_hue = (hue + delta * weight) % 1
    adjusted_rgb = np.rint(hsv_to_rgb(new_hue, new_saturation, value) * 255).clip(0, 255).astype(np.uint8)
    result = original.copy()
    if source.mode == "RGBA":
        visible = original[..., 3] > 0
        result[..., :3][visible] = adjusted_rgb[visible]
        assert np.array_equal(result[..., 3], original[..., 3]), "Alpha must never change."
    else:
        result[..., :3] = adjusted_rgb
    return Image.fromarray(result), float(saturation.mean()), float(new_saturation.mean())


def original_prompt(root, manifest, filename):
    entry = next(item for item in manifest["assets"] if item["filename"] == filename)
    if entry.get("derivedFrom"):
        return original_prompt(root, manifest, entry["derivedFrom"])
    record = json.loads((root / entry["promptSet"]).read_text(encoding="utf-8"))
    return next(item["prompt"] for item in record["assets"] if item["filename"] == filename)


def jobs():
    for family_id, family in FAMILIES.items():
        yield family_id, family["frameSource"], f"card-frame-color-{family_id}.png", "frame"
        for card_id in family["cards"]:
            yield family_id, f"card-pattern-{card_id}.png", f"card-pattern-color-{card_id}.png", "background"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets-root", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "assets")
    parser.add_argument("--verify", action="store_true", help="Recompute grading in memory and compare pixels, alpha, dimensions and recorded hashes.")
    args = parser.parse_args()
    root = args.assets_root
    manifest = json.loads((root / "art-manifest.json").read_text(encoding="utf-8"))
    saved = json.loads((root / RECORD).read_text(encoding="utf-8")) if args.verify else None
    records = []
    for family_id, source_name, filename, kind in jobs():
        recipe = {"kind": kind, "targetHueDegrees": FAMILIES[family_id]["hue"], "saturationMultiplier": 1.95 if kind == "frame" else 1.65,
                  "saturationCap": 0.60 if kind == "frame" else 0.68, "version": 3,
                  **({"titleHeightFraction": 0.12, "titleSaturationRange": [0.18, 0.29]} if kind == "frame" else {})}
        with Image.open(root / source_name) as source:
            assert source.mode in ("RGB", "RGBA")
            adjusted, before, after = grade(source, recipe)
            if args.verify:
                entry = next(item for item in saved["assets"] if item["filename"] == filename)
                with Image.open(root / filename) as actual:
                    assert actual.mode == source.mode and actual.size == source.size, filename
                    assert actual.tobytes() == adjusted.tobytes(), f"{filename}: pixels differ from the recorded color adjustment."
                    if source.mode == "RGBA":
                        assert actual.getchannel("A").tobytes() == source.getchannel("A").tobytes(), f"{filename}: alpha changed."
                assert entry["recipe"] == recipe and entry["sourceSha256"] == digest(root / source_name)
                assert entry["sha256"] == digest(root / filename)
            else:
                adjusted.save(root / filename, format="PNG")
            origin = original_prompt(root, manifest, source_name)
            records.append({"filename": filename, "operation": "color-adjustment", "derivedFrom": source_name,
                            "family": family_id, "recipe": recipe, "size": list(source.size), "mode": source.mode,
                            "sourceSha256": digest(root / source_name), "sha256": digest(root / filename),
                            "meanSaturationBefore": round(before, 5), "meanSaturationAfter": round(after, 5),
                            "prompt": "No new image generation. User-authorized grading of the existing raster; preserve dimensions, alpha, ink and texture. Original image_gen prompt follows:\n" + origin})
            print(f"{filename}: saturation {before:.3f} -> {after:.3f}; original size/mode/alpha preserved")
    if args.verify:
        assert len(records) == 19 and len(saved["assets"]) == 19
        print("Verified four graded frames and fifteen graded backgrounds; no files written.")
    else:
        record = {"generator": "image_gen origin; user-authorized color adjustment only, no new generation",
                  "date": "2026-10-25", "authorization": "用户明确要求四套框、提高框和背景饱和度，直接调整素材，不需要重新生成。",
                  "operation": "color-adjustment", "families": FAMILIES, "assets": records}
        (root / RECORD).write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        output_names = {entry["filename"] for entry in records}
        manifest["assets"] = [entry for entry in manifest["assets"] if entry["filename"] not in output_names]
        for entry in records:
            manifest["assets"].append({"filename": entry["filename"], "purpose": f"用户授权对已有生成位图调色：{entry['family']} {entry['recipe']['kind']}",
                                       "source": "image_gen", "operation": "color-adjustment",
                                       "derivedFrom": entry["derivedFrom"], "promptSet": RECORD})
        (root / "art-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("Recorded 19 color-adjusted derivatives and original generation prompts.")


if __name__ == "__main__":
    main()
