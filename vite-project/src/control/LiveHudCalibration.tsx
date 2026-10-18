import { liveCaptureKeys, liveCaptureLabel, validLiveCaptureRects, type CaptureRect, type LiveCaptureKey } from '../shared/gameCapture';
import { CaptureRegionPicker } from './CaptureRegionPicker';

type Rects=Record<LiveCaptureKey,CaptureRect>;
/** A deliberately manual, operator-approved ROI workflow. No automatic OCR publish before calibration. */
export function LiveHudCalibration({
  zh,regions,onRegionsChange,selected,onSelectedChange,preview,onPreview,ready,onConfirm,calibrated,
}:{
  zh:boolean;regions:Rects;onRegionsChange:(value:Rects)=>void;selected:LiveCaptureKey;
  onSelectedChange:(value:LiveCaptureKey)=>void;preview:string;onPreview:()=>void;
  ready:boolean;onConfirm:()=>void;calibrated:boolean;
}){
  return <details className="ghud-calibration">
    <summary>{zh?'GHUD 七字段位置校准（采集源变化后须重新确认）':'Calibrate the seven HUD digits (confirm for each source)'}</summary>
    <p className="muted">{zh?'先预览真实游戏画面，再选择字段并拖框，只包围数字本身；不要包含装饰图标或两队文字。已有的固定坐标只是示例，未经验证不可自动应用。':'Preview the actual game content and draw tight rectangles around the seven digits. Stock coordinates are examples only.'}</p>
    <div className="toolbar">
      <button type="button" disabled={!ready} onClick={onPreview}>{zh?'预览当前帧':'Preview captured frame'}</button>
      <label>{zh?'选择字段':'Field'}<select aria-label="GHUD calibration field" value={selected} onChange={e=>onSelectedChange(e.target.value as LiveCaptureKey)}>{liveCaptureKeys.map(key=><option key={key} value={key}>{liveCaptureLabel(key,zh)}</option>)}</select></label>
      <button type="button" onClick={onConfirm} disabled={!preview||!validLiveCaptureRects(regions)}>{zh?'保存选框并确认可采样':'Save & confirm calibration'}</button>
      <strong style={{color:calibrated?'#89ecc8':'#ffcb83'}}>{calibrated?(zh?'已确认，可以采样':'Confirmed'):(zh?'未确认 · 禁止自动发布':'Not approved · no auto output')}</strong>
    </div>
    {preview&&<CaptureRegionPicker image={preview} label="GHUD digit selection" zh={zh} selected={selected}
      regions={liveCaptureKeys.map(key=>({id:key,label:liveCaptureLabel(key,zh),region:regions[key]}))} onChange={region=>onRegionsChange({...regions,[selected]:region})}/>}
    <p className="muted">{zh?'注意：切换游戏客户端、镜头布局、16:9 内容裁切或分辨率后，必须重新预览并确认七项字段。':'Recalibrate after changing client, capture region, HUD layout or game resolution.'}</p>
  </details>;
}
