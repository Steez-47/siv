; SIV · Windows shell integration (Tauri NSIS hooks).
; Registers one ProgID (SIV.Image) for every image type, adds SIV to each type's "Open with" list and
; registers Capabilities so SIV appears in Settings > Apps > Default apps. Never overwrites another app's
; default. SHCTX = HKCU (per-user install). Updates run the old uninstaller with /UPDATE; registrations are kept.

!define SIV_PROGID "SIV.Image"
!define SIV_CAPS "Software\SIV\Capabilities"

!macro SIV_REG EXT
  WriteRegStr SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${SIV_PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" "${EXT}" ""
  WriteRegStr SHCTX "${SIV_CAPS}\FileAssociations" "${EXT}" "${SIV_PROGID}"
!macroend

!macro SIV_UNREG EXT
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${SIV_PROGID}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\${SIV_PROGID}" "" "Image"
  WriteRegStr SHCTX "Software\Classes\${SIV_PROGID}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\${SIV_PROGID}\shell" "" "open"
  WriteRegStr SHCTX "Software\Classes\${SIV_PROGID}\shell\open" "" "Open with SIV"
  WriteRegStr SHCTX "Software\Classes\${SIV_PROGID}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "SIV"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "${SIV_CAPS}" "ApplicationName" "SIV"
  WriteRegStr SHCTX "${SIV_CAPS}" "ApplicationDescription" "Steez Image Viewer. Opens images instantly, with crop, adjustments and compare."
  WriteRegStr SHCTX "${SIV_CAPS}" "ApplicationIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\RegisteredApplications" "SIV" "${SIV_CAPS}"
  !insertmacro SIV_REG ".jpg"
  !insertmacro SIV_REG ".jpeg"
  !insertmacro SIV_REG ".jpe"
  !insertmacro SIV_REG ".jfif"
  !insertmacro SIV_REG ".png"
  !insertmacro SIV_REG ".apng"
  !insertmacro SIV_REG ".gif"
  !insertmacro SIV_REG ".webp"
  !insertmacro SIV_REG ".avif"
  !insertmacro SIV_REG ".bmp"
  !insertmacro SIV_REG ".dib"
  !insertmacro SIV_REG ".ico"
  !insertmacro SIV_REG ".tif"
  !insertmacro SIV_REG ".tiff"
  !insertmacro SIV_REG ".tga"
  !insertmacro SIV_REG ".dds"
  !insertmacro SIV_REG ".hdr"
  !insertmacro SIV_REG ".exr"
  !insertmacro SIV_REG ".pnm"
  !insertmacro SIV_REG ".pbm"
  !insertmacro SIV_REG ".pgm"
  !insertmacro SIV_REG ".ppm"
  !insertmacro SIV_REG ".qoi"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    !insertmacro SIV_UNREG ".jpg"
    !insertmacro SIV_UNREG ".jpeg"
    !insertmacro SIV_UNREG ".jpe"
    !insertmacro SIV_UNREG ".jfif"
    !insertmacro SIV_UNREG ".png"
    !insertmacro SIV_UNREG ".apng"
    !insertmacro SIV_UNREG ".gif"
    !insertmacro SIV_UNREG ".webp"
    !insertmacro SIV_UNREG ".avif"
    !insertmacro SIV_UNREG ".bmp"
    !insertmacro SIV_UNREG ".dib"
    !insertmacro SIV_UNREG ".ico"
    !insertmacro SIV_UNREG ".tif"
    !insertmacro SIV_UNREG ".tiff"
    !insertmacro SIV_UNREG ".tga"
    !insertmacro SIV_UNREG ".dds"
    !insertmacro SIV_UNREG ".hdr"
    !insertmacro SIV_UNREG ".exr"
    !insertmacro SIV_UNREG ".pnm"
    !insertmacro SIV_UNREG ".pbm"
    !insertmacro SIV_UNREG ".pgm"
    !insertmacro SIV_UNREG ".ppm"
    !insertmacro SIV_UNREG ".qoi"
    DeleteRegKey SHCTX "Software\Classes\${SIV_PROGID}"
    DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
    DeleteRegKey SHCTX "Software\SIV"
    DeleteRegValue SHCTX "Software\RegisteredApplications" "SIV"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${EndIf}
!macroend
