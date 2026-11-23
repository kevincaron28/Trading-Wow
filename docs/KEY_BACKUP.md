# Backing up the Goblin Ledger upload key

The upload key is the file that proves to Google Play that a new version really comes from you. It lives in one place
today: `C:\Users\Kev\Desktop\wow-trading-signing` on your PC (`goldline-release.p12`, with its password in
`README.txt` next to it). If that disk dies, you can't publish updates until Google replaces the key, which takes days.
Keep two offline copies: one in your password manager and one on a USB drive. Each takes about 10 minutes.

The GitHub secret `GOLDLINE_KEYSTORE_BASE64`, which CI signs with, is **not** a backup: GitHub never shows a secret
again once it's saved.

## 1. In your password manager

Works with Bitwarden, 1Password, Proton Pass and others that accept file attachments.

1. Create a new **Secure note** named `Goblin Ledger upload key`.
2. Attach the file `goldline-release.p12` from `C:\Users\Kev\Desktop\wow-trading-signing`.
3. Open `README.txt` from the same folder and copy the key's password into the note. Add these lines too:
   - Key alias: `goldline`
   - App: `top.kcaron.goldline` (Google Play, developer account KCaron)
   - Upload certificate SHA-256: copy it from Play Console > Goblin Ledger > Test and release > App integrity >
     App signing > **Upload key certificate**.
4. Save, then open the note again and check that the attachment downloads.

## 2. On a USB drive, encrypted

Use a USB drive that stays at home, away from the PC. For example, keep it in a drawer, not in the laptop bag.

1. Install [7-Zip](https://www.7-zip.org/) if you don't have it.
2. Right-click the folder `wow-trading-signing` > **7-Zip** > **Add to archive...**
3. Set:
   - Archive format: **7z**
   - Encryption method: **AES-256**
   - Tick **Encrypt file names**
   - Enter a long passphrase, for example four or five random words. Save this passphrase in the password manager
     note from step 1. Never write it on the USB drive.
4. Click OK. Copy the new `wow-trading-signing.7z` to the USB drive.
5. Test it: double-click the copy on the USB drive, enter the passphrase, and check that `goldline-release.p12` is
   inside. Close it without extracting.

Windows 10 Pro can also lock the whole drive with **BitLocker To Go**: right-click the drive in File Explorer >
**Turn on BitLocker**. The 7-Zip archive alone is enough.

## 3. Once a year

Plug in the USB drive and open the archive, and open the password manager note. Both should still work. If you ever
create a new upload key, redo both copies and delete the old ones.

## If the key is ever lost

Goblin Ledger uses **Play App Signing**: Google holds the real app signing key, and yours is only the upload key. A
lost upload key can be replaced: Play Console > App integrity > App signing > **Request upload key reset**, then
follow Google's steps. Updates are blocked until Google approves the new key (usually a few days). The backups above
avoid that wait.

Never email the `.p12` file, never put it in the repository, and never paste its password into a chat or an issue.
