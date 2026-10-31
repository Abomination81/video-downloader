import os
import shutil
import sys
import subprocess
from pathlib import Path

from install import HOST, app_directory, native_directories


def main():
    app = app_directory()
    if app.exists():
        import install
        install.ensure_idle(app)
    print('Removing the local helper and extension files. Finished downloads will be kept.')
    if sys.platform == 'darwin':
        label = 'com.abomination81.video-downloader.updater'
        subprocess.run(['/bin/launchctl', 'bootout', f'gui/{os.getuid()}/{label}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        (Path.home() / 'Library/LaunchAgents' / f'{label}.plist').unlink(missing_ok=True)
    if os.name == 'nt':
        import winreg
        for browser in ('Google\\Chrome', 'Chromium'):
            try:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, f'Software\\{browser}\\NativeMessagingHosts\\{HOST}')
            except FileNotFoundError:
                pass
    else:
        for directory in native_directories():
            (directory / f'{HOST}.json').unlink(missing_ok=True)
    if app.exists() and '--keep-runtime' not in sys.argv:
        shutil.rmtree(app)
    print('Remove Video Downloader from chrome://extensions to finish uninstalling.')
    print('Shared tools installed with Homebrew or WinGet are kept.')


if __name__ == '__main__':
    main()
