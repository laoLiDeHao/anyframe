; ═══════════════════════════════════════════════════════════════
;  NSIS 自定义脚本（Windows 安装器）
;  由 electron-builder.yml 的 nsis.include 引入
;
;  这里处理三件 electron-builder 默认不做、但本地服务型应用必须做的事：
;    1. 安装前检测并结束正在运行的旧进程（否则文件被占用导致升级失败）
;    2. 卸载时保留用户数据目录（配置与本地服务的工作区）
;    3. 安装完成后写入注册表，供「本地助手」被 Web 版发现时校验版本
; ═══════════════════════════════════════════════════════════════

!macro customHeader
  ; 全局定义，供后续宏使用
  !ifndef APP_GUID
    !define APP_GUID "com.anyframe.desktop"
  !endif
!macroend

!macro customInit
  ; 卸载旧版本前先确保进程已退出，避免 "文件正在使用" 报错
  nsExec::ExecToLog 'taskkill /f /im AnyFrame.exe /t'
  Sleep 800
!macroend

!macro customInstall
  ; 写入版本信息，Web 版本地助手探测时可读取比对
  WriteRegStr SHCTX "Software\AnyFrame" "Version" "${VERSION}"
  WriteRegStr SHCTX "Software\AnyFrame" "InstallDir" "$INSTDIR"

  ; 注册自定义协议 anyframe://，让 Web 版能一键唤起本地助手
  WriteRegStr SHCTX "Software\Classes\anyframe" "" "URL:AnyFrame Protocol"
  WriteRegStr SHCTX "Software\Classes\anyframe" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\anyframe\DefaultIcon" "" "$INSTDIR\AnyFrame.exe,0"
  WriteRegStr SHCTX "Software\Classes\anyframe\shell\open\command" "" '"$INSTDIR\AnyFrame.exe" "%1"'
!macroend

!macro customUnInstall
  ; 停止可能仍在后台运行的本地服务进程
  nsExec::ExecToLog 'taskkill /f /im AnyFrame.exe /t'

  DeleteRegKey SHCTX "Software\AnyFrame"
  DeleteRegKey SHCTX "Software\Classes\anyframe"

  ; 注意：不删除 %APPDATA%\AnyFrame，用户数据与配置保留。
  ; 若产品要求彻底清理，取消下面两行注释：
  ; RMDir /r "$APPDATA\AnyFrame"
  ; RMDir /r "$LOCALAPPDATA\AnyFrame"
!macroend

!macro customRemoveFiles
  ; 默认行为已足够，这里仅保留钩子
!macroend
