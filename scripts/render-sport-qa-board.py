"""Assemble unchanged synthetic native captures for visual review."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
folder = root / 'docs/qa/ascent-sport-20261018'
captures = folder / 'actual'
font_path = 'C:/Windows/Fonts/msyh.ttc'
font = lambda size: ImageFont.truetype(font_path, size)

screens = [('home-light', '训练首页'), ('home-to-workout-light', '训练中'),
           ('summary-light', '完成回顾'), ('history-light', '训练记录')]
width, gap, outer = 460, 28, 44
height = round(width * 2670 / 1200)
board = Image.new('RGB', (outer * 2 + width * 4 + gap * 3, height + 238), '#EDF2FA')
draw = ImageDraw.Draw(board)
draw.text((outer, 27), '循阶 · 原生界面实拍', font=font(36), fill='#152239')
draw.text((outer, 83), 'Xiaomi 14 · Android · 1.25 倍系统字体 · 合成训练数据', font=font(21), fill='#5A6A80')
for index, (name, caption) in enumerate(screens):
    x = outer + index * (width + gap)
    screenshot = Image.open(captures / f'{name}.png').convert('RGB')
    if screenshot.size != (1200, 2670):
        raise RuntimeError(f'Unexpected capture dimensions: {name}')
    board.paste(screenshot.resize((width, height), Image.Resampling.LANCZOS), (x, 139))
    draw.text((x, height + 158), caption, font=font(25), fill='#152239')
board.save(folder / 'native-overview.png')

dark = Image.new('RGB', (outer * 2 + width * 3 + gap * 2, height + 238), '#17253B')
draw = ImageDraw.Draw(dark)
draw.text((outer, 27), '循阶 · 深色主题实拍', font=font(36), fill='#F4F8FF')
draw.text((outer, 83), '与浅色主题共用布局、数据与交互', font=font(21), fill='#B5C7E2')
for index, (name, caption) in enumerate([('home-dark', '训练首页'), ('climbing-dark', '训练中'), ('summary-dark', '完成回顾')]):
    x = outer + index * (width + gap)
    screenshot = Image.open(captures / f'{name}.png').convert('RGB')
    dark.paste(screenshot.resize((width, height), Image.Resampling.LANCZOS), (x, 139))
    draw.text((x, height + 158), caption, font=font(25), fill='#F4F8FF')
dark.save(folder / 'native-dark-overview.png')
