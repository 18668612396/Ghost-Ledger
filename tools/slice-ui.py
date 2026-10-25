import argparse
import ast
import json
from pathlib import Path

from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parent.parent / 'game'
BUTTON_PARTS = ['left', 'middle', 'right']
SCROLL_PARTS = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br']


def alpha_bounds(image):
    if 'A' not in image.getbands():
        return (0, 0, image.width, image.height)
    bounds = image.getchannel('A').getbbox()
    if bounds is None:
        raise ValueError('Source image is fully transparent.')
    return bounds


def rectangle(bounds):
    return [bounds[0], bounds[1], bounds[2] - bounds[0], bounds[3] - bounds[1]]


def image_source(assets_root, filename, sources, trim_override=None):
    image = Image.open(assets_root / filename)
    image.load()
    if image.format != 'PNG':
        raise ValueError(f'{filename} must be PNG.')
    alpha = alpha_bounds(image)
    trim = alpha
    if trim_override:
        left, top, width, height = trim_override
        if min(left, top) < 0 or min(width, height) <= 0 or left + width > image.width or top + height > image.height:
            raise ValueError(f'Explicit trim must stay within {filename}.')
        trim = (left, top, left + width, top + height)
    sources.append({'filename': filename, 'size': [image.width, image.height], 'trim': rectangle(trim), 'alphaBounds': rectangle(alpha), 'trimMethod': 'explicit-rectangle' if trim_override else 'alpha-bounds'})
    return image, trim


def save_piece(assets_root, image, source, bounds, group, part, records):
    filename = f'ref-{group}-{part}.png' if group not in ['brush', 'path'] else f'ref-brush-{part}.png' if group == 'brush' else 'ref-path.png'
    cropped = image.crop(bounds)
    cropped.save(assets_root / filename, format='PNG')
    records.append({
        'filename': filename,
        'source': source,
        'crop': rectangle(bounds),
        'size': [cropped.width, cropped.height],
        'ratio': cropped.width / cropped.height,
        'group': group,
        'part': part,
    })
    return filename


def slice_button(assets_root, requested, sources, records, trim_override=None):
    source = 'ref-button.png'
    image, bounds = image_source(assets_root, source, sources, trim_override)
    left, top, right, bottom = bounds
    width, height = right - left, bottom - top
    cap_left, cap_right = requested or [max(1, round(height * 0.45))] * 2
    if min(cap_left, cap_right) <= 0 or cap_left + cap_right >= width:
        raise ValueError('Button caps must leave a positive middle section.')
    columns = [left, left + cap_left, right - cap_right, right]
    parts = {}
    for index, part in enumerate(BUTTON_PARTS):
        crop = (columns[index], top, columns[index + 1], bottom)
        parts[part] = save_piece(assets_root, image, source, crop, 'button', part, records)
    image.close()
    return {'source': source, 'referenceSize': [width, height], 'insets': {'left': cap_left, 'right': cap_right}, 'parts': parts}


def slice_scroll(assets_root, requested, sources, records):
    source = 'ref-scroll.png'
    image, bounds = image_source(assets_root, source, sources)
    left, top, right, bottom = bounds
    width, height = right - left, bottom - top
    cap_top, cap_right, cap_bottom, cap_left = requested or [round(height * 0.12), round(width * 0.12), round(height * 0.12), round(width * 0.12)]
    if min(cap_top, cap_right, cap_bottom, cap_left) <= 0 or cap_left + cap_right >= width or cap_top + cap_bottom >= height:
        raise ValueError('Scroll insets must leave a positive center section.')
    columns = [left, left + cap_left, right - cap_right, right]
    rows = [top, top + cap_top, bottom - cap_bottom, bottom]
    parts = {}
    for index, part in enumerate(SCROLL_PARTS):
        column, row = index % 3, index // 3
        crop = (columns[column], rows[row], columns[column + 1], rows[row + 1])
        parts[part] = save_piece(assets_root, image, source, crop, 'scroll', part, records)
    image.close()
    return {'source': source, 'referenceSize': [width, height], 'insets': {'top': cap_top, 'right': cap_right, 'bottom': cap_bottom, 'left': cap_left}, 'parts': parts}


def slice_auxiliary(assets_root, sources, records, path_trim=None):
    if (assets_root / 'ref-brushes.png').exists():
        image, unused_bounds = image_source(assets_root, 'ref-brushes.png', sources)
        for index, color in enumerate(['teal', 'red', 'jade']):
            start = image.height * index // 3
            end = image.height * (index + 1) // 3
            row = image.crop((0, start, image.width, end))
            bounds = alpha_bounds(row)
            crop = (bounds[0], bounds[1] + start, bounds[2], bounds[3] + start)
            save_piece(assets_root, image, 'ref-brushes.png', crop, 'brush', color, records)
        image.close()
    if (assets_root / 'map-path.png').exists():
        image, bounds = image_source(assets_root, 'map-path.png', sources, path_trim)
        save_piece(assets_root, image, 'map-path.png', bounds, 'path', 'path', records)
        image.close()


def verify_pipeline():
    forbidden = {'resize', 'thumbnail', 'rotate', 'transform', 'filter', 'point', 'paste', 'putpixel', 'putdata', 'alpha_composite', 'blend', 'composite', 'new'}
    tree = ast.parse(Path(__file__).read_text(encoding='utf-8'))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in forbidden:
            raise ValueError(f'Image modification is prohibited: {node.func.attr}')
        if isinstance(node, ast.ImportFrom) and node.module == 'PIL' and any(alias.name != 'Image' for alias in node.names):
            raise ValueError('Only PIL.Image may be imported by the slicing pipeline.')


def verify_outputs(assets_root):
    verify_pipeline()
    data = json.loads((assets_root / 'ref-slices.json').read_text(encoding='utf-8'))
    if data.get('operation') != 'crop-only':
        raise ValueError('Slicing metadata must declare crop-only.')
    sources = {source['filename']: source for source in data['sources']}
    for record in data['assets']:
        with Image.open(assets_root / record['source']) as source:
            source.load()
            if [source.width, source.height] != sources[record['source']]['size']:
                raise ValueError(f'Source size changed: {record["source"]}')
            if rectangle(alpha_bounds(source)) != sources[record['source']].get('alphaBounds', sources[record['source']]['trim']):
                raise ValueError(f'Source trim changed: {record["source"]}')
            left, top, width, height = record['crop']
            expected = source.crop((left, top, left + width, top + height))
            with Image.open(assets_root / record['filename']) as actual:
                actual.load()
                if actual.mode != expected.mode or actual.size != expected.size or actual.tobytes() != expected.tobytes():
                    raise ValueError(f'Pixel data is not an exact source crop: {record["filename"]}')
    print(json.dumps({'operation': 'crop-only', 'verified': len(data['assets']), 'resampled': False}))


def configured_insets(assets_root, options):
    metadata_path = assets_root / 'ref-slices.json'
    if not metadata_path.exists():
        return
    previous = json.loads(metadata_path.read_text(encoding='utf-8'))
    previous_sources = {source['filename']: source for source in previous.get('sources', [])}
    for kind, source_name in [('button', 'ref-button.png'), ('scroll', 'ref-scroll.png')]:
        source = previous_sources.get(source_name)
        skin = previous.get('skins', {}).get(kind)
        if not source or not skin:
            continue
        with Image.open(assets_root / source_name) as image:
            if [image.width, image.height] != source['size']:
                continue
        if kind == 'button':
            if options.button_caps is None:
                options.button_caps = [skin['insets']['left'], skin['insets']['right']]
            if options.button_trim is None and source.get('trimMethod') == 'explicit-rectangle':
                options.button_trim = source['trim']
        elif options.scroll_insets is None:
            options.scroll_insets = [skin['insets'][side] for side in ['top', 'right', 'bottom', 'left']]
    path_source = previous_sources.get('map-path.png')
    if options.path_trim is None and path_source and path_source.get('trimMethod') == 'explicit-rectangle':
        with Image.open(assets_root / 'map-path.png') as image:
            if [image.width, image.height] == path_source['size']:
                options.path_trim = path_source['trim']


def main():
    parser = argparse.ArgumentParser(description='Crop generated UI PNGs into proportion-preserving pieces without resampling.')
    parser.add_argument('--assets-root', type=Path, default=PROJECT_ROOT / 'public' / 'assets')
    parser.add_argument('--button-caps', type=int, nargs=2, metavar=('LEFT', 'RIGHT'))
    parser.add_argument('--button-trim', type=int, nargs=4, metavar=('X', 'Y', 'WIDTH', 'HEIGHT'))
    parser.add_argument('--path-trim', type=int, nargs=4, metavar=('X', 'Y', 'WIDTH', 'HEIGHT'))
    parser.add_argument('--scroll-insets', type=int, nargs=4, metavar=('TOP', 'RIGHT', 'BOTTOM', 'LEFT'))
    parser.add_argument('--verify', action='store_true')
    options = parser.parse_args()
    assets_root = options.assets_root.resolve()
    if options.verify:
        verify_outputs(assets_root)
        return
    verify_pipeline()
    configured_insets(assets_root, options)
    sources, records = [], []
    skins = {
        'button': slice_button(assets_root, options.button_caps, sources, records, options.button_trim),
        'scroll': slice_scroll(assets_root, options.scroll_insets, sources, records),
    }
    slice_auxiliary(assets_root, sources, records, options.path_trim)
    data = {'version': 1, 'operation': 'crop-only', 'sources': sources, 'skins': skins, 'assets': records}
    serialized = json.dumps(data, ensure_ascii=False, indent=2)
    (assets_root / 'ref-slices.json').write_text(serialized + '\n', encoding='utf-8')
    (PROJECT_ROOT / 'src' / 'skin-data.js').write_text('export const SKIN_DATA = Object.freeze(' + serialized + ');\n', encoding='utf-8')
    verify_outputs(assets_root)


if __name__ == '__main__':
    main()
