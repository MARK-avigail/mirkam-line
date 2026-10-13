from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[2]
res=root/'apps/native/android/app/src/main/res'
icon=Image.open(root/'public/mirkam/icon-512.png').convert('RGBA')
for density,size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
    folder=res/f'mipmap-{density}'
    folder.mkdir(parents=True,exist_ok=True)
    for name in ['ic_launcher','ic_launcher_round','ic_launcher_foreground']:
        icon.resize((size,size),Image.Resampling.LANCZOS).save(folder/f'{name}.png')
# Use the approved full icon instead of Capacitor's default adaptive launcher art.
for folder in res.glob('mipmap-anydpi*'):
    for name in ['ic_launcher.xml','ic_launcher_round.xml']:
        (folder/name).unlink(missing_ok=True)
