import { useEffect,useId,useRef,useState } from 'react';
import { parseManualNumber,type ManualNumberRules } from './manualNumber';

interface Props extends ManualNumberRules {
  value:number|undefined;
  label:string;
  zh:boolean;
  disabled:boolean;
  placeholder?:string;
  onCommit:(value:number|undefined)=>void;
}

export function ManualNumberInput({value,label,zh,disabled,placeholder,min,max,integer=true,allowEmpty=false,onCommit}:Props){
  const [text,setText]=useState(String(value??''));
  const [error,setError]=useState('');
  const dirty=useRef(false),submitted=useRef<string>();
  const errorId=useId();
  useEffect(()=>{
    const parsed=parseManualNumber(text,{min,max,integer,allowEmpty});
    if(!dirty.current||parsed.valid&&parsed.value===value){
      dirty.current=false;setText(String(value??''));setError('');
    }
  },[value,text,min,max,integer,allowEmpty]);
  useEffect(()=>{if(!disabled)submitted.current=undefined;},[disabled]);
  function commit(){
    if(disabled||!dirty.current||submitted.current===text)return;
    const parsed=parseManualNumber(text,{min,max,integer,allowEmpty});
    if(!parsed.valid){
      setError(parsed.reason==='integer'?(zh?'请输入整数。':'Enter a whole number.'):(zh?`请输入 ${min}–${max} 范围内的数字。`:`Enter a number from ${min} to ${max}.`));
      return;
    }
    setError('');
    if(parsed.value===value){dirty.current=false;return;}
    submitted.current=text;onCommit(parsed.value);
  }
  return <span style={{display:'inline-flex',flexDirection:'column',maxWidth:'100%'}}>
    <input aria-label={label} aria-invalid={!!error} aria-describedby={error?errorId:undefined} type="text" inputMode={integer?'numeric':'decimal'} value={text} placeholder={placeholder} disabled={disabled}
      onChange={event=>{dirty.current=true;submitted.current=undefined;setText(event.target.value);setError('');}}
      onBlur={commit} onKeyDown={event=>{
        if(event.key==='Enter'){event.preventDefault();event.stopPropagation();commit();}
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dirty.current=false;submitted.current=undefined;setText(String(value??''));setError('');}
      }}/>
    {error&&<small id={errorId} className="error" role="alert">{error}</small>}
  </span>;
}
