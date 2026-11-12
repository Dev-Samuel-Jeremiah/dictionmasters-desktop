; Extra steps in the Windows installer (electron-builder runs customInstall
; after the app's own files are in).
;
; A level's videos are too big to go inside its installer (Windows
; installers stop at 2 GB), so they travel beside it, in a "videos" folder
; on the flash drive. Copied in here, the computer needs nothing else. They
; stay sealed: they open only with this computer's unlock code.
!macro customInstall
  IfFileExists "$EXEDIR\videos\*.*" 0 dm_no_videos_beside
    DetailPrint "Copying this level's videos. This can take several minutes..."
    CreateDirectory "$INSTDIR\resources\content\blobs"
    CopyFiles "$EXEDIR\videos\*.*" "$INSTDIR\resources\content\blobs"
  dm_no_videos_beside:
!macroend
