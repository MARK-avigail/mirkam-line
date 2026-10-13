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

# The existing recording UI needs Android's runtime microphone permission.
import xml.etree.ElementTree as ET
manifest=res.parent/'AndroidManifest.xml'
ET.register_namespace('android','http://schemas.android.com/apk/res/android')
tree=ET.parse(manifest)
name='{http://schemas.android.com/apk/res/android}name'
if not any(node.attrib.get(name)=='android.permission.RECORD_AUDIO' for node in tree.getroot().findall('uses-permission')):
    tree.getroot().append(ET.Element('uses-permission',{name:'android.permission.RECORD_AUDIO'}))
tree.write(manifest,encoding='utf-8',xml_declaration=True)

# Install the native activity that handles system bars and keyboard insets.
import shutil
activity=res.parent/'java/ai/mavrika/mirkamline/MainActivity.java'
activity.parent.mkdir(parents=True,exist_ok=True)
for source in (root/'apps/native/android-template').glob('*.java'):
    shutil.copyfile(source,activity.parent/source.name)
assets=res.parent/'assets'
assets.mkdir(exist_ok=True)
shutil.copyfile(root/'apps/native/update-public.pem',assets/'update-public.pem')
gradle=res.parents[2]/'build.gradle'
text=gradle.read_text().replace('versionCode 1','versionCode 3').replace('versionName "1.0"','versionName "0.4.0"')
gradle.write_text(text)

# Run the actual Android update-store implementation in Robolectric before producing the APK.
tests=res.parents[1]/'test/java/ai/mavrika/mirkamline'
tests.mkdir(parents=True,exist_ok=True)
shutil.copyfile(root/'apps/native/android-template/LocalUpdatesTest.java.fixture',tests/'LocalUpdatesTest.java')
resources=res.parents[1]/'test/resources'
resources.mkdir(parents=True,exist_ok=True)
shutil.copyfile(root/'updates/android.json',resources/'signed-android-update.json')
with gradle.open('a') as out:
    out.write('\nandroid { testOptions { unitTests { includeAndroidResources = true } } }\ndependencies { testImplementation "junit:junit:4.13.2"; testImplementation "org.robolectric:robolectric:4.14.1" }\n')
