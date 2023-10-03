# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files
from PyInstaller.utils.hooks import copy_metadata
import sys ; sys.setrecursionlimit(sys.getrecursionlimit() * 5)
datas = []
datas += collect_data_files('torch')
datas += collect_data_files('whisper')
datas += copy_metadata('tqdm')
datas += copy_metadata('regex')
datas += copy_metadata('sacremoses')
datas += copy_metadata('requests')
datas += copy_metadata('packaging')
datas += copy_metadata('filelock')
datas += copy_metadata('numpy')
datas += copy_metadata('tokenizers')
block_cipher = None


a = Analysis(
    ['main.py', 'ai.py'],
    pathex=[],
    binaries=[('/usr/local/bin/ffmpeg', '.'),
    ('/usr/local/opt/libarchive/lib/libarchive.13.dylib', '.'),
    ('/usr/local/lib/libavcodec.60.3.100.dylib', '.'),
    ('/usr/local/lib/libavcodec.60.dylib', '.'),
    ('/usr/local/lib/libavcodec.dylib', '.'),
    ('/usr/local/lib/libavdevice.60.1.100.dylib', '.'),
    ('/usr/local/lib/libavdevice.60.dylib', '.'),
    ('/usr/local/lib/libavdevice.dylib', '.'),
    ('/usr/local/lib/libavfilter.9.3.100.dylib', '.'),
    ('/usr/local/lib/libavfilter.9.dylib', '.'),
    ('/usr/local/lib/libavfilter.dylib', '.'),
    ('/usr/local/lib/libavformat.60.3.100.dylib', '.'),
    ('/usr/local/lib/libavformat.60.dylib', '.'),
    ('/usr/local/lib/libavformat.dylib', '.'),
    ('/usr/local/lib/libavutil.58.2.100.dylib', '.'),
    ('/usr/local/lib/libavutil.58.dylib', '.'),
    ('/usr/local/lib/libavutil.dylib', '.'),
    ('/usr/local/lib/libpostproc.57.dylib', '.'),
    ('/usr/local/lib/libpostproc.dylib', '.'),
    ('/usr/local/lib/libpostproc.57.1.100.dylib', '.'),
    ('/usr/local/lib/libswresample.4.dylib', '.'),
    ('/usr/local/lib/libswresample.dylib', '.'),
    ('/usr/local/lib/libswscale.7.dylib', '.'),
    ('/usr/local/lib/libswscale.dylib', '.'),
    ('/usr/local/bin/ffprobe','.')],
    datas=datas,
    hiddenimports=['pytorch', 'pkg_resources.py2_warn', 'whisper'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

a.datas += Tree('./model', prefix='model')

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='NocturneAI',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='Punch_Logo.ico'

)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='gui',
)

app = BUNDLE(
    coll,
    name='NocturneAI.app',
    icon=None,
    bundle_identifier="com.hanztech.nocturneai",
    info_plist={
        'NSMicrophoneUsageDescription':'Reason for microphone access',
        'NSPrincipalClass': 'NSApplication',
        'NSAppleScriptEnabled': False,
        "CFBundleDocumentTypes": [
            {
                "CFBundleTypeExtensions": ["pt"],
                "CFBundleTypeName": "[pt]",
                "CFBundleTypeRole": "Editor",
                "CFBundleTypeOSTypes": ["****"],
            }
        ]
    },
)