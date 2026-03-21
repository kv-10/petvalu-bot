import zipfile, os

stored   = ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png', 'icon.png']
deflated = ['manifest.json', 'popup.html', 'popup.js', 'background.js', 'gmail.js', 'vercel.json']

with zipfile.ZipFile('petvalu-bot.xpi', 'w') as zf:
    for fname in stored:
        info = zipfile.ZipInfo(fname)
        info.compress_type = zipfile.ZIP_STORED
        info.create_version = 10
        info.extract_version = 10
        with open(fname, 'rb') as f:
            zf.writestr(info, f.read())
    for fname in deflated:
        info = zipfile.ZipInfo(fname)
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_version = 20
        info.extract_version = 20
        with open(fname, 'rb') as f:
            zf.writestr(info, f.read())

print(f"Built petvalu-bot.xpi: {os.path.getsize('petvalu-bot.xpi')} bytes")
with zipfile.ZipFile('petvalu-bot.xpi') as zf:
    for info in zf.infolist():
        print(f"  {info.filename}: {info.file_size}b compress={info.compress_type} extract_version={info.extract_version}")
