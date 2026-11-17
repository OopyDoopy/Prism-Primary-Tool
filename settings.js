/* Browser-local settings. Versioned cookie fields use stable element IDs. */
(() => {
  'use strict';
  const key='prism_settings_v1';
  const status=document.getElementById('settingsStatus');
  const controls=[...document.querySelectorAll('input[id],select[id]')].filter(el=>el.id!=='exrSelect');
  let savedImage='', timer=null;
  const fail=message=>{status.textContent=message;status.className='warn';};
  function decode(value){const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));return JSON.parse(new TextDecoder().decode(bytes));}
  function encode(value){const bytes=new TextEncoder().encode(JSON.stringify(value));return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));}
  function read(){
    try {
      const entry=document.cookie.split('; ').find(c=>c.startsWith(key+'='));
      if(!entry)return null;
      const result=decode(entry.slice(key.length+1));
      return result && result.version===1 && result.controls && typeof result.controls==='object'?result:null;
    } catch(e) {fail('Saved settings could not be read; using defaults.');return null;}
  }
  function restore(){
    const state=read();if(!state)return;
    savedImage=typeof state.image==='string'?state.image:'';
    window.prismSavedImage=savedImage;
    // Restore selectors and checkboxes first so dynamic range limits are correct.
    for(const el of controls.filter(el=>el.tagName==='SELECT'||el.type==='checkbox')){
      // Migrate the previous saturation basis to the shared selector.
      const v=el.id==='chromaSpace' ? (state.controls.chromaSpace ?? state.controls.satSpace) : state.controls[el.id];
      if(el.type==='checkbox'){if(typeof v==='boolean')el.checked=v;}
      else if(typeof v==='string' && [...el.options].some(o=>o.value===v))el.value=v;
    }
    updateReachLimits();
    for(const el of controls.filter(el=>el.tagName==='INPUT' && el.type!=='checkbox')){
      let v=state.controls[el.id];
      // Preserve the effective strength saved by either previous slider mapping.
      if((el.id==='deepShadowV2'||el.id==='deepShadowV2N') && v===undefined){
        let effective;
        if(typeof state.controls.deepShadow==='string'){const old=Math.max(0,Math.min(1,Number(state.controls.deepShadow)));effective=(2**(4*old)-1)/15;}
        else if(typeof state.controls.flare==='string')effective=Math.max(0,Math.min(1,Number(state.controls.flare)));
        if(Number.isFinite(effective))v=String(effective**0.2);
      }
      if(typeof v!=='string'||v.trim()===''||!Number.isFinite(Number(v)))continue;
      if(el.type==='number' && ((el.min!=='' && Number(v)<Number(el.min))||(el.max!=='' && Number(v)>Number(el.max))))continue;
      el.value=v;
    }
    markAuthorCustom();updateAll();
  }
  function save(){
    timer=null;
    try {
      const values={};
      for(const el of controls){
        if(el.type==='checkbox') values[el.id]=el.checked;
        else if(el.tagName==='SELECT'||(el.value!=='' && Number.isFinite(Number(el.value)))) values[el.id]=el.value;
      }
      const select=document.getElementById('exrSelect');
      if(select.dataset.loaded==='true')savedImage=select.value;
      const value=encode({version:1,controls:values,image:savedImage});
      if(value.length>3800)throw Error('Settings exceed the browser cookie size limit.');
      document.cookie=key+'='+value+'; Max-Age=31536000; Path=/; SameSite=Lax';
      if(!document.cookie.split('; ').some(c=>c.startsWith(key+'='+value)))throw Error('Cookies are blocked.');
      status.textContent='Settings saved in this browser.';status.className='muted';
    } catch(e){fail('Settings could not be saved: '+e.message);}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(save,250);}
  restore();
  document.addEventListener('input',event=>{if(event.target.matches('input[id],select[id]'))schedule();});
  document.addEventListener('change',event=>{if(event.target.matches('input[id],select[id]'))schedule();});
  // Presets and group resets update controls programmatically.
  document.addEventListener('click',event=>{if(event.target.closest('button[data-gamut],button.resetPrimary,#exampleNatural,#exampleAgxLike,#resetAuthor,#resetGrade,#presetNatural,#presetAgxLike,#resetAll,button.resetSlider'))schedule();});
  window.addEventListener('pagehide',()=>{if(timer){clearTimeout(timer);save();}});
})();
