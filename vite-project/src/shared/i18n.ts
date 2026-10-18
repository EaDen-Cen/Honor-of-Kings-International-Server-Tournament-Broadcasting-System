import type { Language } from './types.js';

const messages = {
  heroSort: {zh:'排序方式',eng:'Sort by'},
  heroSortChinese: {zh:'中文名称',eng:'Chinese name'},
  heroSortEnglish: {zh:'英文名称',eng:'English name'},
  heroSortRelease: {zh:'上线时间（新→旧）',eng:'Release date (newest)'},
  heroSortPickRate: {zh:'官方选取率（高→低）',eng:'Official pick rate (highest)'},
  heroSortLane: {zh:'分路（对抗→中路→发育→打野→游走）',eng:'Lane (Clash → Mid → Farm → Jungle → Roam)'},
  heroSortDataCoverage: {zh:'该排序已有 {known}/{total} 位英雄的数据；缺失数据的英雄会排在已知数据之后。',eng:'This sort has data for {known}/{total} heroes; heroes with missing data are placed after known values.'},
  heroImageSettings: {zh:'英雄数据与图片',eng:'Hero data & artwork'},
  heroDataSettings: {zh:'英雄数据',eng:'Hero data'},
  heroEnglishName: {zh:'英文名',eng:'English name'},
  heroChineseName: {zh:'中文名',eng:'Chinese name'},
  heroPrimaryLane: {zh:'主分路',eng:'Primary lane'},
  heroSecondaryLane: {zh:'副分路',eng:'Secondary lane'},
  heroAliases: {zh:'搜索别名',eng:'Search aliases'},
  heroAliasesHint: {zh:'使用逗号分隔，可用于搜索。',eng:'Comma-separated aliases used by search.'},
  heroStudioSearch: {zh:'快速查找英雄',eng:'Quick hero search'},
  heroStudioSearchHint: {zh:'名称、英文名、别名或拼音声母；Enter 选择首个结果',eng:'Name, alias or initials; Enter selects the first result'},
  heroStudioSearchResult: {zh:'匹配 {count} 位英雄',eng:'{count} heroes matched'},
  heroStudioSearchHintGrid: {zh:'输入中文名、英文名、别名或拼音声母，下面会立即过滤',eng:'Type a Chinese/English name, alias, or initials to filter the grid instantly'},
  heroStudioSearchResults: {zh:'英雄搜索结果',eng:'Hero search results'},
  heroStudioResultCount: {zh:'显示 {shown} / {total}',eng:'Showing {shown} / {total}'},
  heroStudioLoadMore: {zh:'再显示 48 个',eng:'Load 48 more'},
  heroStudioShowAll: {zh:'显示全部',eng:'Show all'},
  heroPortraitOverride: {zh:'头像图片来源',eng:'Portrait image source'},
  heroFullArtOverride: {zh:'高清封面来源',eng:'Full-art source'},
  heroSourceOverrideHint: {zh:'支持 HTTPS 或站内绝对路径；仅覆盖当前赛事运行数据，不修改同步生成文件。',eng:'Accepts HTTPS or an absolute local path. Overrides runtime match data only and does not edit generated sync files.'},
  noSecondaryLane: {zh:'无',eng:'None'},
  saveHeroData: {zh:'保存英雄数据',eng:'Save hero data'},
  resetHeroData: {zh:'重置英雄数据',eng:'Reset hero data'},
  heroDataOverrideInvalid: {zh:'英雄数据设置无效，请检查名称、分路、别名与图片地址。',eng:'Invalid hero data settings. Check names, lanes, aliases and image URLs.'},
  closeHeroImageSettings: {zh:'关闭英雄图片设置',eng:'Close hero artwork'},
  heroImageSource: {zh:'英雄主图来源',eng:'Hero art source'},
  heroImageAuto: {zh:'高清封面优先',eng:'Prefer full art'},
  heroImageLegacy: {zh:'旧版头像',eng:'Legacy icons'},
  showHeroName: {zh:'显示英雄名称',eng:'Show hero name'},
  showHeroNameHint: {zh:'关闭后直播卡片仅显示选手名称。',eng:'When off, broadcast cards show only player names.'},
  chooseHeroToEdit: {zh:'选择要调整的英雄',eng:'Choose hero to adjust'},
  useLegacyForHero: {zh:'此英雄使用旧版图片',eng:'Use legacy image for this hero'},
  cropPanel: {zh:'底部横排裁切',eng:'Bottom panel crop'},
  cropSide: {zh:'左右竖排裁切',eng:'Side crop'},
  cropX: {zh:'横向焦点',eng:'Horizontal focus'},
  cropY: {zh:'纵向焦点',eng:'Vertical focus'},
  cropScale: {zh:'缩放',eng:'Zoom'},
  artReference: {zh:'完整图片参考',eng:'Full-art reference'},
  artReferenceHint: {zh:'两个白框分别表示底部横排和左右竖排的参考取景范围；下方预览为真实 CSS 裁切。',eng:'The two white frames represent the bottom-panel and side-layout reference crops. Live previews below use the actual CSS crop.'},
  livePreview: {zh:'实时预览',eng:'Live preview'},
  saveHeroArt: {zh:'保存英雄图片调整',eng:'Save artwork adjustment'},
  resetCrop: {zh:'重置当前布局',eng:'Reset current layout'},
  resetHeroArt: {zh:'重置此英雄全部调整',eng:'Reset all hero adjustments'},
  fullArtUnavailable: {zh:'此英雄没有高清封面，将自动使用旧版图片。',eng:'No full artwork is available; the legacy image will be used.'},
  heroArtCropInvalid: {zh:'英雄图片裁切参数无效，请重新调整。',eng:'Invalid hero artwork crop. Adjust the crop and try again.'},
  heroArtOverrideInvalid: {zh:'英雄图片设置无效，请重新调整。',eng:'Invalid hero artwork settings. Adjust them and try again.'},
  lineupInvalid: {zh:'最终阵容归属无效：每队 5 个已选英雄必须各分配给一名选手。',eng:'Invalid final lineup: each of the five picked heroes must be assigned to exactly one player.'},
  lineupIncomplete: {zh:'请先确认双方最终英雄归属，再提交本局。',eng:'Confirm both teams’ final hero ownership before committing the game.'},
  scoreDisplay: {zh:'比分显示',eng:'Score display'},
  scoreNumber: {zh:'数字比分',eng:'Numbers'},
  scoreBoxes: {zh:'赛事格子',eng:'Win boxes'},
  bpInputMode: {zh:'BP 输入模式',eng:'BP input mode'},
  manualInput: {zh:'手动选择',eng:'Manual selection'},
  screenInput: {zh:'屏幕识别（人工确认）',eng:'Screen recognition (review required)'},
  rosterSource: {zh:'选手资料来源',eng:'Roster source'},
  substitutes: {zh:"替补名单",eng:"Substitutes"},
  addSubstitute: {zh:"添加替补",eng:"Add substitute"},
  removeSubstitute: {zh:"移除替补",eng:"Remove substitute"},
  substituteName: {zh:"替补选手 ID",eng:"Substitute player ID"},
  substitutesInvalid: {zh:"替补资料无效：最多 20 人，请检查重复 ID、分路和图片地址",eng:"Invalid substitutes: up to 20 players; check duplicate IDs, roles and image URLs."},
  quickSubstitution: {zh:"快速换人",eng:"Quick substitution"},
  chooseRosterPlayer: {zh:"选择已保存选手",eng:"Choose saved player"},
  targetSlot: {zh:"替换位置",eng:"Replace slot"},
  applySubstitute: {zh:"填入选手资料",eng:"Fill player details"},
  substituteHint: {zh:"选择选手和位置后填入，再保存比赛设置同步。可选择首发换回；不会改动资料库。",eng:"Choose a player and slot, fill their details, then save match settings to sync. Saved starters can be restored. The library stays unchanged."},
  substituteNeedsTeam: {zh:"选择本队的已保存资料，即可调用首发及替补；不会更换比赛队伍身份",eng:"Choose your saved team to recall starters and substitutes without changing match team identity."},
  starter: {zh:"首发",eng:"Starter"},
  reserve: {zh:"替补",eng:"Substitute"},
  substituteFilled: {zh:"已填入选手资料，请保存比赛设置",eng:"Player details filled. Save match settings to sync."},
  libraryPortraitUploadHint: {zh:'PNG / JPEG / WebP，最大 5 MB。上传后保存队伍资料即可保留。',eng:'PNG / JPEG / WebP, up to 5 MB. Save the team to keep the uploaded portrait.'},
  teamLibrary: {zh:"队伍资料库",eng:"Team library"},
  chooseTeam: {zh:"选择已保存队伍",eng:"Choose saved team"},
  loadTeam: {zh:"载入比赛",eng:"Load into match"},
  saveNewTeam: {zh:"另存为新队伍",eng:"Save as new team"},
  updateSavedTeam: {zh:"更新已保存队伍",eng:"Update saved team"},
  manageTeams: {zh:"管理队伍资料",eng:"Manage saved teams"},
  newTeam: {zh:"新建队伍",eng:"New team"},
  deleteTeam: {zh:"删除队伍资料",eng:"Delete saved team"},
  saveTeam: {zh:"保存队伍资料",eng:"Save team"},
  searchTeams: {zh:"搜索队伍",eng:"Search teams"},
  presetSaved: {zh:"队伍资料已保存",eng:"Team saved"},
  presetDeleted: {zh:"队伍资料已删除，当前比赛不受影响",eng:"Team deleted. The current match is unchanged."},
  presetLocked: {zh:"系列赛开始后不能载入其他队伍。仍可修改当前选手资料。",eng:"Teams cannot be loaded during an active series. Current roster details remain editable."},
  presetDuplicate: {zh:"双方不能载入同一支队伍",eng:"The same team cannot play both sides."},
  presetMissing: {zh:"找不到该队伍，请刷新资料库",eng:"Team not found. Refresh the library."},
  presetInvalid: {zh:"队伍资料无效，请检查队名、5 名选手、分路及图片地址",eng:"Invalid team details. Check the name, five players, roles, and image URLs."},
  presetSaveFailed: {zh:"队伍资料保存失败，请检查连接或服务器存储",eng:"Unable to save team details. Check the connection or server storage."},
  presetCopyHint: {zh:"载入后独立编辑；保存比赛设置不会覆盖资料库。",eng:"Loaded teams are independent copies. Saving match settings does not update the library."},
  confirmDeleteTeam: {zh:"删除此队伍资料？当前比赛和历史记录将保留。",eng:"Delete this saved team? Current match and history will be preserved."},
  confirmUpdateTeam: {zh:"将当前资料覆盖到已保存队伍？",eng:"Replace the saved team with these details?"},
  confirmLoadTeam: {zh:"载入队伍将替换当前阵容，未保存的比赛设置将丢失。继续？",eng:"Loading a team replaces the roster and discards unsaved match settings. Continue?"},
  refreshTeams: {zh:"刷新资料库",eng:"Refresh library"},
  noTeams: {zh:"尚无队伍资料",eng:"No saved teams"},
  closeLibrary: {zh:"关闭队伍资料库",eng:"Close team library"},
  choosePortrait: { zh: '选择图片', eng: 'Choose image' },
  clearPortrait: { zh: '清空图片', eng: 'Clear image' },
  portraitPreview: { zh: '选手照片预览', eng: 'Player portrait preview' },
  portraitEmpty: { zh: '未设置选手照片，将使用队徽或编号', eng: 'No portrait set. The team logo or slot number will be used.' },
  portraitLoading: { zh: '正在加载照片…', eng: 'Loading portrait…' },
  portraitLoaded: { zh: '照片加载成功', eng: 'Portrait loaded' },
  portraitFailed: { zh: '照片加载失败，请检查链接或重新上传', eng: 'Portrait failed to load. Check the URL or upload again.' },
  portraitUploadHint: { zh: 'PNG / JPEG / WebP，最大 5 MB。上传后保存设置即可同步。选中英雄后主图显示英雄。', eng: 'PNG / JPEG / WebP, up to 5 MB. Save settings after uploading to sync. After a pick, the main image shows the hero.' },
  uploading: { zh: '正在上传…', eng: 'Uploading…' },
  uploadTooLarge: { zh: '图片超过 5 MB，请选择更小的文件', eng: 'Image exceeds 5 MB. Choose a smaller file.' },
  uploadFormat: { zh: '请选择有效的 PNG、JPEG 或 WebP 图片', eng: 'Choose a valid PNG, JPEG or WebP image.' },
  uploadUnauthorized: { zh: '仅导播控制端可以上传图片，请检查访问口令', eng: 'Only Control can upload images. Check your access token.' },
  uploadFailed: { zh: '图片上传失败，请重试', eng: 'Image upload failed. Please try again.' },
  emptyBan: { zh:'空 Ban', eng:'Empty ban' },
  emptyBanButton: { zh:'空 Ban / 跳过本次禁用', eng:'Empty ban / Skip this ban' },
  emptyBanManualHint: { zh:'只推进当前 Ban 阶段，不会占用任何英雄。可撤销。', eng:'Advances only the current Ban phase without consuming a hero. Undo remains available.' },
  emptyBanRecorded: { zh:'已记录：{side} 空 Ban', eng:'Recorded: {side} empty ban' },
  emptyBanSuspected: { zh:'疑似空 Ban · 稳定检测 {count}/3', eng:'Possible empty ban · stable detection {count}/3' },
  emptyBanReviewTitle: { zh:'检测到疑似空 Ban', eng:'Possible empty ban detected' },
  emptyBanReviewHint: { zh:'连续 3 次画面稳定且没有可靠英雄候选。请确认这确实是空 Ban；识别不会自行提交。', eng:'The frame stayed stable for 3 scans with no reliable hero candidate. Confirm that this is really an empty ban; recognition never submits it automatically.' },
  emptyBanConfirm: { zh:'确认空 Ban', eng:'Confirm empty ban' },
  autoCaptureWatch: { zh:'自动监视当前 BP 槽位', eng:'Auto-watch current BP slot' },
  autoCaptureWatchHint: { zh:'自动读取当前区域并等待人工审核；空 Ban 只在低置信度且画面连续稳定 3 次后提示。', eng:'Repeatedly reads the current region and waits for review. Empty bans are suggested only after low confidence and 3 stable frames.' },
  captureSource: { zh:'采集来源', eng:'Capture source' },
  windowCaptureMode: { zh:'游戏窗口', eng:'Game window' },
  nativeCaptureMode: { zh:'兼容模式', eng:'Legacy capture' },
  windowCaptureChoose: { zh:'选择游戏窗口', eng:'Choose game window' },
  windowCaptureChange: { zh:'更换窗口', eng:'Change window' },
  windowCaptureDisconnect: { zh:'断开窗口', eng:'Disconnect window' },
  windowCaptureDisconnected: { zh:'未连接游戏窗口', eng:'No game window connected' },
  windowCaptureConnected: { zh:'已连接游戏窗口', eng:'Game window connected' },
  windowCaptureChooseHint: { zh:'点击“选择游戏窗口”，然后在浏览器弹窗中选择王者荣耀或模拟器窗口。', eng:'Choose the game window, then select Honor of Kings or the emulator in the browser share dialog.' },
  windowCaptureUnsupported: { zh:'当前浏览器不支持窗口采集；请使用 Chrome / Edge 的 HTTPS 或 localhost 页面，或切换兼容模式。', eng:'This browser cannot capture a window. Use Chrome / Edge on HTTPS or localhost, or switch to legacy capture.' },
  windowCaptureCancelled: { zh:'已取消窗口选择。', eng:'Window selection cancelled.' },
  windowCaptureFailed: { zh:'无法连接游戏窗口，请重新选择或切换兼容模式。', eng:'Could not connect to the game window. Try again or use legacy capture.' },
  windowCaptureEnded: { zh:'游戏窗口共享已停止，请重新连接。', eng:'Game-window sharing stopped. Reconnect to continue.' },
  windowCaptureNotConnected: { zh:'请先连接游戏窗口。', eng:'Connect the game window first.' },
  windowCaptureRecognitionFailed: { zh:'窗口画面识别失败，请检查连接、识别框或服务器。', eng:'Window-frame recognition failed. Check the connection, recognition box, or server.' },
  windowCaptureRecognitionArea: { zh:'BP 识别区域', eng:'BP recognition area' },
  windowCaptureCalibrate: { zh:'框选识别区域', eng:'Calibrate recognition area' },
  windowCaptureDragNow: { zh:'请在画面上拖拽框选', eng:'Drag on the preview now' },
  windowCaptureResetArea: { zh:'重置识别框', eng:'Reset area' },
  windowCaptureRegionSaved: { zh:'识别区域已保存；以后会按窗口比例自动适配。', eng:'Recognition area saved. It will scale with the game window.' },
  windowCaptureRelativeHint: { zh:'识别框使用窗口相对比例保存；移动窗口、改变分辨率或 Windows 缩放后无需重新输入像素坐标。', eng:'The recognition box is saved relative to the window, so moving or resizing the window does not require new pixel coordinates.' },
  windowCaptureAutoHint: { zh:'连接保持期间会直接读取游戏窗口；浏览器刷新或停止共享后需要重新选择窗口。', eng:'Auto-watch reads the selected game window directly. Reconnect after a page refresh or when sharing stops.' },
  nativeCaptureAdvanced: { zh:'高级兼容模式：Windows 桌面坐标', eng:'Advanced legacy mode: Windows desktop coordinates' },
  nativeCaptureHint: { zh:'仅在浏览器窗口采集不可用时使用；该模式仍需要本机 Windows 服务和像素坐标。', eng:'Use only if browser window capture is unavailable. This mode still requires the local Windows service and pixel coordinates.' },
  captureFourZoneHint: { zh:'只需校准蓝/红双方的 Pick 列和 Ban 区共 4 个区域；程序会根据当前 BP 阶段自动截取正在变化的单个槽位，不再把整张 BP 画面拿去匹配英雄。', eng:'Calibrate four regions: blue/red Pick columns and Ban rows. Auto BP then crops only the active slot for the current draft phase instead of matching the whole draft screen.' },
  captureExplicitSlotsHint: { zh:'改为 18 个独立识别框：蓝/红各 4 个 Ban、各 5 个 Pick。每个框都可以单独拖拽校准，程序不会再根据整列/整行自动均分。', eng:'Uses 18 independent recognition boxes: 4 Ban and 5 Pick slots per side. Every box is calibrated separately; the app no longer auto-splits a row or column.' },
  captureLiveWorkspaceHint: { zh:'比赛中只保留画面、当前阶段、候选结果和常用操作；识别框校准与预设已移到下方折叠工具区。', eng:'During a match, keep only the preview, current phase, candidate result, and common actions visible. Calibration and presets are collapsed below.' },
  captureCalibrationToolsTitle: { zh:'识别框校准与工具', eng:'Recognition-box calibration & tools' },
  captureCalibrationToolsHint: { zh:'通常只在第一次配置或画面布局改变时使用', eng:'Usually needed only for first-time setup or when the game layout changes' },
  captureStatusLabel: { zh:'识别状态', eng:'Recognition status' },
  captureRefreshing: { zh:'正在刷新识别', eng:'Refreshing recognition' },
  captureWaitingForFrame: { zh:'等待下一次画面识别。', eng:'Waiting for the next recognition scan.' },
  captureManualCandidate: { zh:'手动确认当前最高候选', eng:'Review current top candidate' },
  captureManualCandidateHint: { zh:'当英雄已经锁定但自动锁定判断没有触发时，用当前扫描结果中的最高相似度英雄组打开人工确认。', eng:'If the hero is already locked but automatic lock detection did not trigger, review the highest-similarity hero group from the latest scan.' },
  captureManualCandidateOpened: { zh:'已使用当前最高相似度候选打开人工确认。', eng:'Opened manual review with the latest top candidate(s).' },
  manualFallbackTitle: { zh:'手动英雄选择（备用）', eng:'Manual hero picker (fallback)' },
  manualFallbackHint: { zh:'屏幕识别正常时可保持收起；需要人工修正或临时手动录入时再展开。', eng:'Keep this collapsed while screen recognition is working. Expand it only for manual correction or fallback entry.' },
  captureCalibrateExplicitSlots: { zh:'18 槽位独立校准', eng:'18-slot independent calibration' },
  captureExplicitCalibrationHint: { zh:'先点击一个 B1–B4 或 P1–P5，再到游戏预览中直接框住该英雄头像区域。不同槽位可使用完全不同的大小和位置。', eng:'Choose B1–B4 or P1–P5, then drag directly over that exact hero portrait in the game preview. Every slot can have a different size and position.' },
  captureExplicitSlot: { zh:'{side} {action} {number}', eng:'{side} {action} {number}' },
  captureDragSelectedSlot: { zh:'正在校准：{slot}。请直接在预览画面拖出新的识别框。', eng:'Calibrating {slot}. Drag a new recognition rectangle directly on the preview.' },
  captureExplicitSlotSaved: { zh:'已保存 {slot} 的独立识别框。', eng:'Saved the independent recognition box for {slot}.' },
  captureExplicitSlotsReset: { zh:'18 个识别框已恢复默认位置；仍可逐个重新校准。', eng:'All 18 boxes were reset to defaults; each can still be recalibrated independently.' },
  captureResetAllSlots: { zh:'重置全部 18 个框', eng:'Reset all 18 boxes' },
  capturePresetTitle: { zh:'18 框位置预设', eng:'18-box calibration presets' },
  capturePresetHint: { zh:'保存当前 18 个识别框的位置与大小。以后选择预设并载入即可，不会影响 BP 数据。识别框按窗口比例保存。', eng:'Save the positions and sizes of all 18 recognition boxes. Load a preset later without affecting draft data. Boxes are stored relative to the game window.' },
  capturePresetName: { zh:'预设名称', eng:'Preset name' },
  capturePresetNamePlaceholder: { zh:'例如：HOK 1920×1080 / 比赛服', eng:'e.g. HOK 1920×1080 / Tournament client' },
  capturePresetSaveNew: { zh:'保存当前为新预设', eng:'Save current as new preset' },
  capturePresetSavedList: { zh:'已保存预设', eng:'Saved presets' },
  capturePresetChoose: { zh:'选择一个预设…', eng:'Choose a preset…' },
  capturePresetLoad: { zh:'载入预设', eng:'Load preset' },
  capturePresetOverwrite: { zh:'用当前 18 框覆盖', eng:'Overwrite with current boxes' },
  capturePresetDelete: { zh:'删除预设', eng:'Delete preset' },
  capturePresetRelative: { zh:'相对窗口比例', eng:'Window-relative' },
  capturePresetNameRequired: { zh:'请先输入预设名称。', eng:'Enter a preset name first.' },
  capturePresetNameDuplicate: { zh:'已有同名预设；请选择它后使用“覆盖”更新，或换一个名称。', eng:'A preset with this name already exists. Select it and overwrite it, or use a different name.' },
  capturePresetChooseFirst: { zh:'请先选择一个已保存的识别框预设。', eng:'Choose a saved capture preset first.' },
  capturePresetSaved: { zh:'已保存识别框预设：{name}', eng:'Saved capture preset: {name}' },
  capturePresetUpdated: { zh:'已更新识别框预设：{name}', eng:'Updated capture preset: {name}' },
  capturePresetLoaded: { zh:'已载入识别框预设：{name}', eng:'Loaded capture preset: {name}' },
  capturePresetDeleted: { zh:'已删除识别框预设：{name}', eng:'Deleted capture preset: {name}' },
  capturePresetDeleteConfirm: { zh:'删除识别框预设“{name}”？当前正在使用的 18 个框不会被改变。', eng:'Delete capture preset “{name}”? The 18 boxes currently in use will stay unchanged.' },
  capturePresetCollapsedHint: { zh:'低频工具：需要保存或切换 18 框布局时再展开', eng:'Low-frequency tool: expand only when saving or switching an 18-box layout' },
  capturePresetSelected: { zh:'当前选择：{name}', eng:'Selected: {name}' },
  captureExplicitAutoHint: { zh:'自动监视只读取当前 BP 阶段对应的那个独立识别框；不会根据其他框的位置推算。', eng:'Auto-watch reads only the independent box assigned to the current BP phase; no position is inferred from neighboring boxes.' },
  precisionOpenFullscreen: { zh:'⛶ 全屏精细校准', eng:'⛶ Fullscreen fine calibration' },
  precisionCalibrationTitle: { zh:'精细校准', eng:'Fine calibration' },
  precisionZoom: { zh:'画面缩放', eng:'Preview zoom' },
  precisionFit: { zh:'100%', eng:'100%' },
  precisionPreviousSlot: { zh:'上一槽', eng:'Previous slot' },
  precisionNextSlot: { zh:'下一槽', eng:'Next slot' },
  precisionExit: { zh:'退出', eng:'Exit' },
  precisionKeyboardHint: { zh:'方向键移动 1 个源像素 · Shift+方向键调整宽高 · +/- 缩放 · [ ] 或 Enter 切换槽位 · Esc 退出', eng:'Arrow keys move 1 source pixel · Shift+arrows resize · +/- zoom · [ ] or Enter changes slot · Esc exits' },
  precisionActualInput: { zh:'识别器实际输入', eng:'Actual recognition crop' },
  captureZoneBluePick: { zh:'蓝方 Pick 列', eng:'Blue Pick column' },
  captureZoneRedPick: { zh:'红方 Pick 列', eng:'Red Pick column' },
  captureZoneBlueBan: { zh:'蓝方 Ban 区', eng:'Blue Ban row' },
  captureZoneRedBan: { zh:'红方 Ban 区', eng:'Red Ban row' },
  captureCalibrateFourZones: { zh:'四区域校准', eng:'Four-region calibration' },
  captureZoneCalibrationHint: { zh:'依次点击一个区域按钮，再在游戏画面上拖框。Pick 列会自动纵向切成 5 个槽位；Ban 区会按当前模式横向切成 2 或 4 个槽位。', eng:'Choose a region and drag over it in the game preview. Pick columns are split vertically into 5 slots; Ban rows are split horizontally into 2 or 4 slots for the current mode.' },
  captureZoneSaved: { zh:'已保存 {zone}；区域会随游戏窗口缩放。', eng:'Saved {zone}; it will scale with the game window.' },
  captureZonesReset: { zh:'四个识别区域已恢复默认位置。', eng:'All four recognition regions were reset to defaults.' },
  captureCurrentSlot: { zh:'{side} {action} {current}/{total}', eng:'{side} {action} {current}/{total}' },
  capturePhaseLabel: { zh:'当前阶段', eng:'Current phase' },
  captureSlotLabel: { zh:'识别槽位', eng:'Recognition slot' },
  captureCandidateLabel: { zh:'英雄候选', eng:'Hero candidate' },
  captureEmptyBanLabel: { zh:'空 Ban 检测', eng:'Empty-ban check' },
  captureWaiting: { zh:'等待画面', eng:'Waiting for frame' },
  captureNoCandidate: { zh:'暂无可靠候选', eng:'No reliable candidate' },
  captureHeroCandidate: { zh:'{hero} · {confidence}% · 稳定 {count}/{required}', eng:'{hero} · {confidence}% · stable {count}/{required}' },
  captureHeroStable: { zh:'{hero} · {confidence}% · 已达到稳定 {count}/{required}', eng:'{hero} · {confidence}% · stable {count}/{required}' },
  captureWaitingForStableHero: { zh:'等待同一英雄连续稳定出现；不会因单帧结果直接弹确认。', eng:'Waiting for the same hero to remain stable across scans; a single frame will not trigger review.' },
  captureNoActiveSlot: { zh:'当前没有可识别的 BP 槽位。', eng:'There is no active BP slot to recognize.' },
  captureAutoSlotHint: { zh:'自动监视只读取当前阶段对应的单个英雄槽位；英雄需连续稳定 2 次才弹审核。', eng:'Auto-watch reads only the exact slot for the current phase; a hero must remain stable for 2 scans before review.' },
  captureNotApplicable: { zh:'不适用', eng:'N/A' },
  capturePromptedOnce: { zh:'本阶段已询问过，不会再次弹出', eng:'Already asked this phase; will not prompt again' },
  captureGraceThenCheck: { zh:'保护等待 {seconds}s 后才开始判断', eng:'Starts checking after {seconds}s grace' },
  emptyBanGraceWaiting: { zh:'空 Ban 保护期：还需等待约 {seconds}s；期间只识别正常英雄。', eng:'Empty-ban grace period: about {seconds}s remaining. Normal hero recognition stays active.' },
  emptyBanSuppressed: { zh:'本 Ban 阶段已经询问过空 Ban，不会重复询问；英雄识别继续运行。', eng:'Empty ban was already reviewed this phase and will not be asked again; hero recognition continues.' },
  emptyBanAwaitLockCue: { zh:'等待右下角锁定标记变化；仅“低英雄相似度”不会再被当作空 Ban。', eng:'Waiting for the lower-right lock cue. Low hero similarity alone no longer counts as an empty ban.' },
  emptyBanLockCueWaiting: { zh:'检测到右下角锁定标记变化 · 空槽稳定 {count}/3', eng:'Lower-right lock cue changed · empty slot stable {count}/3' },
  emptyBanReviewHintOnce: { zh:'当前 Ban 槽位出现了右下角锁定/确认标记，同时没有可靠英雄匹配，并连续 3 次保持稳定。请确认是否空 Ban；如果拒绝，本阶段不会再次询问，但仍会继续识别正常英雄。', eng:'The Ban slot gained the lower-right locked/confirmed cue, no reliable hero match was found, and the slot remained stable for 3 scans. Confirm an empty ban if correct. If rejected, this phase will not ask again while hero recognition continues.' },
  captureNow: { zh:'立即识别', eng:'Recognize now' },
  emptyBanOnlyDuringBan: { zh:'只有当前阶段为 Ban 时才能记录空 Ban。', eng:'An empty ban can only be recorded during a Ban phase.' },
  quickInputHint: { zh: '/ 或 Ctrl+K 搜索 · 中文模式支持拼音声母（如 lplp）· Enter 录入当前第一个可用结果 · Esc 清空', eng: '/ or Ctrl+K to search · Enter submits the first available filtered result · Esc clears' },
  recordAccepted: { zh: '已记录：{side} {action} · {hero}', eng: 'Recorded: {side} {action} · {hero}' },
  pickAction: { zh: '选择', eng: 'PICK' },
  banAction: { zh: '禁用', eng: 'BAN' },
  banCount: { zh: '禁用 {number}/{total}', eng: 'BAN {number}/{total}' },
  noMatchingHeroes: { zh: '没有匹配的英雄，请清空搜索或调整分路筛选', eng: 'No matching heroes. Clear the search or change the lane filter.' },

  opponentAlreadyUsed: { zh: '对手在此前有效局已选过此英雄，无需禁用', eng: 'The opponent already used this hero in a committed game. No ban needed.' },
  portrait: { zh: '选手形象地址', eng: 'Player portrait URL' },
  portraitHint: { zh: 'HTTPS 图片链接或 /playerImg/ 本地路径；留空使用队徽。', eng: 'HTTPS image URL or /playerImg/ local path. Leave blank to use the team logo.' },
  portraitInvalid: { zh: '选手形象须为 HTTPS 图片链接或单斜线开头的本地路径', eng: 'Use an HTTPS portrait URL or a local path starting with one slash.' },
  portraitsInvalid: { zh: '每支队伍必须设置 5 个选手形象位置', eng: 'Each team must have 5 portrait slots.' },
  firstPickSide: { zh: 'BP 先手方', eng: 'Draft starting side' },
  firstPickLocked: { zh: '选禁开始后先手方锁定，请重置选禁或进入下一局后修改', eng: 'The starting side locks once drafting begins. Reset the draft or start the next game to change it.' },
  sideSwapMode: { zh: '换边方式', eng: 'Side swap behavior' },
  moveTeams: { zh: '交换队伍显示位置', eng: 'Move teams between screen sides' },
  colorsOnly: { zh: '队伍位置不变，仅交换蓝红方', eng: 'Keep screen positions, swap colors' },
  confirmColorsSwap: { zh: '两队显示位置保持不变，交换蓝红方归属？比分、选手和历史仍跟随原队伍，先手方不变。', eng: 'Keep team screen positions and swap blue/red sides? Scores, players and history follow each team. The starting side stays unchanged.' },
  screenLeft: { zh: '画面左侧', eng: 'Screen left' },
  screenRight: { zh: '画面右侧', eng: 'Screen right' },

  backendUpgrade: { zh: '当前连接的是旧版服务。请停止旧进程并重新启动服务器，V2 操作将在连接新版服务后启用。', eng: 'Connected to an older server. Stop it and restart the server to enable V2 controls.' },
  draftRules: { zh: 'BP 规则', eng: 'BP rules' },
  flowbornRule: { zh: '元流之子计算规则', eng: 'Flowborn counting rule' },
  flowbornIndependent: { zh: '各形态独立计算', eng: 'Count each form separately' },
  flowbornShared: { zh: '所有形态视为同一英雄', eng: 'Treat all forms as one hero' },
  flowbornRuleHint: { zh: '关闭独立计算后，任一元流之子被 Ban 或 Pick 后，其他形态在本局也不可再使用；跨局限制遵循当前 BP 规则。', eng: 'When forms are shared, banning or picking any Flowborn blocks every other form in the current game; cross-game restrictions follow the selected BP rule.' },
  flowbornAlreadyUsed: { zh: '本场规则将所有元流之子视为同一英雄，已有一个形态被选择或禁用', eng: 'This match treats all Flowborn forms as one hero, and one form has already been picked or banned.' },
  ruleNormal: { zh: '普通 BP', eng: 'NORMAL BP' },
  rulePlayer: { zh: '选手 BP', eng: 'PLAYER BP' },
  ruleGlobal: { zh: '全局 BP', eng: 'GLOBAL BP' },
  historyTitle: { zh: '有效局历史', eng: 'COMMITTED GAMES' },
  noHistory: { zh: '尚无已确认的有效局', eng: 'No committed games yet' },
  historyNormal: { zh: '仅供回顾，不限制下一局英雄。', eng: 'For reference only. Previous picks remain available.' },
  historyPlayer: { zh: '按选手 ID 限制重复英雄，队友可使用；换人时请填写新选手自己的 ID。', eng: 'Restrictions follow player IDs. Teammates may reuse heroes. Enter each substitute’s own ID.' },
  historyGlobal: { zh: '同一队伍已使用的英雄不可再次选择；换边、换人不清空历史。', eng: 'A team cannot reuse its committed picks. History follows teams across side swaps and substitutions.' },
  commitGame: { zh: '确认本局有效', eng: 'Commit game' },
  nextGame: { zh: '开始下一局', eng: 'Start next game' },
  swapSides: { zh: '交换蓝红方', eng: 'Swap sides' },
  confirmCommit: { zh: '确认本局比赛有效、英雄归属正确？提交后将计入跨局历史；比分请单独更新。', eng: 'Confirm this game is valid and player assignments are correct? Its picks will enter history. Update the score separately.' },
  confirmNext: { zh: '确认进入下一局？当前选禁画面将清空，已提交历史保留。', eng: 'Start the next game? Clear the current draft and retain committed history.' },
  confirmSwap: { zh: '交换两队、选手和比分的蓝红位置？历史将继续跟随原队伍。', eng: 'Swap teams, players and scores between blue and red? History will follow each team.' },
  gameCommitted: { zh: '本局已提交', eng: 'Game committed' },
  lifecycleHint: { zh: '比赛结束后确认本局有效 → 更新比分 → 开始下一局。原 BP 重开无需重复提交；无效 BP 在提交前重置。', eng: 'After play: commit the valid game → update score → start the next game. Replays with the same draft need no second commit; reset invalid drafts before committing.' },
  assignmentTitle: { zh: '英雄归属校对', eng: 'Review player assignments' },
  assignmentHint: { zh: '每个位置对应选手 ID。选择另一位英雄会交换两名选手的英雄，服务器会重新检查资格。', eng: 'Each slot belongs to its player ID. Choosing another hero swaps assignments; the server rechecks eligibility.' },
  pickingFor: { zh: '当前为 {player} 选择英雄（第 {slot} 位）', eng: 'Picking for {player} (slot {slot})' },
  playerMissing: { zh: '请先填写该位置的选手 ID', eng: 'Enter this slot’s player ID first.' },
  usedByPlayer: { zh: '该选手在此前有效局已使用此英雄', eng: 'This player used this hero in a committed game.' },
  usedByTeam: { zh: '该队伍在此前有效局已使用此英雄', eng: 'This team used this hero in a committed game.' },
  gameAlreadyCommitted: { zh: '本局已提交，不能重复提交或修改英雄归属', eng: 'This game is committed. It cannot be committed again or reassigned.' },
  completeDraftFirst: { zh: '请先完成本局选禁', eng: 'Complete the current draft first.' },
  commitBeforeNext: { zh: '请先确认本局有效', eng: 'Commit the current game first.' },
  updateScoreBeforeNext: { zh: '请核对系列赛比分，再进入对应的下一局', eng: 'Check the series score before starting the corresponding next game.' },
  seriesHasEnded: { zh: '系列赛已结束，请重置整场比赛开始新系列赛', eng: 'The series has ended. Reset the match to start a new series.' },
  swapOnlyBetweenGames: { zh: '仅可在两局之间、选禁开始前交换蓝红方', eng: 'Swap sides between games, before the draft starts.' },
  committedDraftReset: { zh: '本局已提交，请使用“开始下一局”；若提交有误，可撤销至提交前', eng: 'This draft is committed. Start the next game, or undo to before the commit if it was invalid.' },
  rulesLocked: { zh: '选禁开始后规则锁定；存在有效局历史时需重置整场比赛才能修改规则或赛制', eng: 'Rules lock when drafting starts. Reset the match to change rules or series format after a committed game.' },
  duplicatePlayerIds: { zh: '选手 BP 要求每位选手 ID 唯一', eng: 'Player BP requires a unique ID for every player.' },
  rosterLocked: { zh: '选禁开始后选手及分路锁定，请在下一局开始前修改', eng: 'Players and roles lock during the draft. Change them before the next draft.' },
  scoreImmediate: { zh: '比分直接同步；其他设置需保存。', eng: 'Score changes sync immediately. Save other settings separately.' },
  "appName": {
    "zh": "王者荣耀赛事转播系统",
    "eng": "HOK Broadcast System"
  },
  "gameTitle": {
    "zh": "王者荣耀国际服",
    "eng": "HONOR OF KINGS"
  },
  "brandTitle": {
    "zh": "王者荣耀",
    "eng": "HOK"
  },
  "brandSubtitle": {
    "zh": "赛事转播",
    "eng": "Broadcast"
  },
  "communitySystem": {
    "zh": "社区赛事转播系统",
    "eng": "Community Broadcast System"
  },
  "casterEyebrow": {
    "zh": "社区赛事 · 解说工作台",
    "eng": "COMMUNITY ESPORTS · CASTER DESK"
  },
  "controlEyebrow": {
    "zh": "社区赛事 · 导播控制台",
    "eng": "COMMUNITY ESPORTS · PRODUCTION"
  },
  "casterLogin": {
    "zh": "解说工作台登录",
    "eng": "Caster access"
  },
  "controlLogin": {
    "zh": "赛事控制台登录",
    "eng": "Control access"
  },
  "accessToken": {
    "zh": "访问口令",
    "eng": "Access token"
  },
  "connect": {
    "zh": "连接",
    "eng": "Connect"
  },
  "logout": {
    "zh": "退出登录",
    "eng": "Sign out"
  },
  "controlRealtime": {
    "zh": "控制台 · 实时状态",
    "eng": "CONTROL · REALTIME"
  },
  "delayedFeed": {
    "zh": "解说画面 · 延迟 {seconds} 秒",
    "eng": "CASTER · DELAYED {seconds}s"
  },
  "disconnectedNotice": {
    "zh": "连接未就绪，操作已禁用。现有画面保留，正在恢复服务器状态。",
    "eng": "Connection unavailable. Controls are disabled while the current picture is held and server state reloads."
  },
  "connectingServer": {
    "zh": "正在连接比赛服务器…",
    "eng": "Connecting to match server…"
  },
  "readOnlyFooter": {
    "zh": "只读解说视图 · 延迟时间轴",
    "eng": "Read-only caster view · Delayed timeline"
  },
  "serverFooter": {
    "zh": "比赛数据由服务器统一同步",
    "eng": "Match data synchronized by the server"
  },
  "rosterUpdated": {
    "zh": "英雄资料更新于 {date}",
    "eng": "Hero roster updated {date}"
  },
  "ban": {
    "zh": "禁用",
    "eng": "BAN"
  },
  "emptyPick": {
    "zh": "待选",
    "eng": "PICK"
  },
  "draftComplete": {
    "zh": "选禁完成",
    "eng": "DRAFT COMPLETE"
  },
  "banHero": {
    "zh": "{team}禁用英雄",
    "eng": "{team} BANNING"
  },
  "pickHero": {
    "zh": "{team}选择英雄",
    "eng": "{team} PICKING"
  },
  "phaseStep": {
    "zh": "第 {step} 步，共 {total} 步",
    "eng": "STEP {step} OF {total}"
  },
  "gameNumber": {
    "zh": "第 {number} 局",
    "eng": "GAME {number}"
  },
  "playerNumber": {
    "zh": "选手 {number}",
    "eng": "Player {number}"
  },
  "blueSide": {
    "zh": "蓝方",
    "eng": "Blue"
  },
  "redSide": {
    "zh": "红方",
    "eng": "Red"
  },
  "blueTeam": {
    "zh": "蓝方队伍",
    "eng": "TEAM BLUE"
  },
  "redTeam": {
    "zh": "红方队伍",
    "eng": "TEAM RED"
  },
  "blueAnalysis": {
    "zh": "蓝方阵容分析",
    "eng": "Blue draft analysis"
  },
  "redAnalysis": {
    "zh": "红方阵容分析",
    "eng": "Red draft analysis"
  },
  "opponent": {
    "zh": "对手：{team}",
    "eng": "Opponent: {team}"
  },
  "synergy": {
    "zh": "搭配推荐",
    "eng": "Synergy / Combo"
  },
  "ourCounters": {
    "zh": "我方克制",
    "eng": "Our picks counter"
  },
  "counteredBy": {
    "zh": "我方被克制",
    "eng": "Threats to our picks"
  },
  "enemyCounters": {
    "zh": "克制对手的推荐",
    "eng": "Counters to enemy picks"
  },
  "relationshipHint": {
    "zh": "结合双方已选英雄展示关系，原有数据供解说参考。",
    "eng": "Relationships based on both teams' picks. Original data for caster reference."
  },
  "noRelationships": {
    "zh": "暂无关系数据",
    "eng": "No relationship data"
  },
  "matchSettings": {
    "zh": "比赛设置",
    "eng": "Match settings"
  },
  "teamSettings": {
    "zh": "队伍设置",
    "eng": "Team settings"
  },
  "closeTeamSettings": {
    "zh": "关闭队伍设置",
    "eng": "Close team settings"
  },
  "hideSettings": {
    "zh": "收起比赛设置",
    "eng": "Hide match settings"
  },
  "teamName": {
    "zh": "队伍名称",
    "eng": "Team name"
  },
  "logoAddress": {
    "zh": "队徽图片地址",
    "eng": "Team logo URL"
  },
  "logoPlaceholder": {
    "zh": "填写图片链接或本地资源路径",
    "eng": "Enter an image URL or local asset path"
  },
  "players": {
    "zh": "选手名单",
    "eng": "Players"
  },
  "lane": {
    "zh": "分路",
    "eng": "Lane"
  },
  "clash": {
    "zh": "对抗路",
    "eng": "Clash Lane"
  },
  "jungle": {
    "zh": "打野",
    "eng": "Jungling"
  },
  "mid": {
    "zh": "中路",
    "eng": "Mid Lane"
  },
  "farm": {
    "zh": "发育路",
    "eng": "Farm Lane"
  },
  "roam": {
    "zh": "游走",
    "eng": "Roaming"
  },
  "all": {
    "zh": "全部",
    "eng": "All"
  },
  "seriesScore": {
    "zh": "系列赛比分",
    "eng": "Series score"
  },
  "decreaseScore": {
    "zh": "减少系列赛比分",
    "eng": "Decrease series score"
  },
  "increaseScore": {
    "zh": "增加系列赛比分",
    "eng": "Increase series score"
  },
  "matchDisplay": {
    "zh": "赛制与显示",
    "eng": "Match and display"
  },
  "stage": {
    "zh": "比赛阶段",
    "eng": "Match stage"
  },
  "seriesFormat": {
    "zh": "系列赛赛制",
    "eng": "Series format"
  },
  "bo1": {
    "zh": "一局定胜负",
    "eng": "Best of 1"
  },
  "bo3": {
    "zh": "三局两胜",
    "eng": "Best of 3"
  },
  "bo5": {
    "zh": "五局三胜",
    "eng": "Best of 5"
  },
  "currentGame": {
    "zh": "当前局",
    "eng": "Current game"
  },
  "automatic": {
    "zh": "自动计算",
    "eng": "Calculated automatically"
  },
  "draftMode": {
    "zh": "BP 形式",
    "eng": "BP format"
  },
  "matchMode": {
    "zh": "赛事模式 · 每队禁用 4 位",
    "eng": "Match · 4 bans per team"
  },
  "normalMode": {
    "zh": "普通模式 · 每队禁用 2 位",
    "eng": "Normal · 2 bans per team"
  },
  "language": {
    "zh": "界面语言",
    "eng": "Interface language"
  },
  "chinese": {
    "zh": "中文",
    "eng": "Chinese"
  },
  "english": {
    "zh": "英文",
    "eng": "English"
  },
  "languageHint": {
    "zh": "保存后，界面与英雄名称将一起切换。",
    "eng": "Save to switch the entire interface and hero names."
  },
  "overlayLayout": {
    "zh": "直播布局",
    "eng": "Overlay layout"
  },
  "panelLayout": {
    "zh": "底部横排",
    "eng": "Bottom panel"
  },
  "sideLayout": {
    "zh": "左右竖排",
    "eng": "Side columns"
  },
  "saveSettings": {
    "zh": "保存设置",
    "eng": "Save settings"
  },
  "undo": {
    "zh": "撤销上次操作",
    "eng": "Undo last action"
  },
  "resetDraft": {
    "zh": "重置选禁",
    "eng": "Reset draft"
  },
  "resetMatch": {
    "zh": "重置整场比赛",
    "eng": "Reset match"
  },
  "confirmResetDraft": {
    "zh": "确定清空当前选禁？队伍设置和比分将保留。",
    "eng": "Reset this draft? Team settings and scores will be kept."
  },
  "confirmResetMatch": {
    "zh": "确定重置整场比赛？队伍、比分和选禁都会清空。",
    "eng": "Reset the entire match? Teams, scores and draft will be cleared."
  },
  "casterDelay": {
    "zh": "解说延迟 · {seconds} 秒",
    "eng": "Caster delay · {seconds}s"
  },
  "increaseDelay": {
    "zh": "增加解说延迟 {seconds} 秒",
    "eng": "Increase caster delay by {seconds} seconds"
  },
  "decreaseDelay": {
    "zh": "减少解说延迟 {seconds} 秒",
    "eng": "Decrease caster delay by {seconds} seconds"
  },
  "secondsShort": {
    "zh": "秒",
    "eng": "s"
  },
  "delayInput": {
    "zh": "解说延迟秒数",
    "eng": "Caster delay seconds"
  },
  "setDelay": {
    "zh": "设置延迟",
    "eng": "Set delay"
  },
  "selectHero": {
    "zh": "点击一位英雄确认",
    "eng": "Select one hero to confirm"
  },
  "searchHeroes": {
    "zh": "搜索英雄",
    "eng": "Search heroes"
  },
  "availabilityHint": {
    "zh": "元流之子按形态录入；形态及联动英雄的可用范围，以本场游戏房间为准。",
    "eng": "Enter Flowborn by form. Form and crossover eligibility follows the current game lobby."
  },
  "statusConnecting": {
    "zh": "正在连接",
    "eng": "Connecting"
  },
  "statusConnected": {
    "zh": "已连接",
    "eng": "Connected"
  },
  "statusReconnecting": {
    "zh": "正在重连",
    "eng": "Reconnecting"
  },
  "statusTokenRequired": {
    "zh": "请输入访问口令",
    "eng": "Access token required"
  },
  "statusInvalidToken": {
    "zh": "访问口令无效",
    "eng": "Invalid token"
  },
  "statusRejected": {
    "zh": "无访问权限",
    "eng": "Access rejected"
  },
  "statusUnavailable": {
    "zh": "连接未就绪",
    "eng": "Connection unavailable"
  },
  "stageCommunity": {
    "zh": "社区赛事",
    "eng": "COMMUNITY TOURNAMENT"
  },
  "stageGroup": {
    "zh": "小组赛",
    "eng": "Group Stage"
  },
  "stageQuarter": {
    "zh": "四分之一决赛",
    "eng": "Quarterfinal"
  },
  "stageSemi": {
    "zh": "半决赛",
    "eng": "Semifinal"
  },
  "stageFinal": {
    "zh": "决赛",
    "eng": "Final"
  },
  "stageGrandFinal": {
    "zh": "总决赛",
    "eng": "Grand Final"
  }
} as const;

export type MessageKey = keyof typeof messages;
export function translate(lang: Language, key: MessageKey, params: Record<string, string | number> = {}) {
  return messages[key][lang].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
export const translator = (lang: Language) => (key: MessageKey, params?: Record<string, string | number>) => translate(lang, key, params);
