/* CIE 1931 xy primary authoring, ported from Prism's CPU prism.hpp (AgX inset/outset branch). */
'use strict';
const $=id=>document.getElementById(id);
const P709={r:[.640,.330],g:[.300,.600],b:[.150,.060],w:[.3127,.3290]};
const PP3={r:[.680,.320],g:[.265,.690],b:[.150,.060],w:[.3127,.3290]};
const P2020={r:[.708,.292],g:[.170,.797],b:[.131,.046],w:[.3127,.3290]};
const PAP1={r:[.713,.293],g:[.165,.830],b:[.128,.044],w:[.32168,.33767]};
const M709XYZ=[.4123907993,.3575843394,.1804807884,.2126390059,.7151686788,.0721923154,.0193308187,.1191947798,.9505321522];
const MXYZ709=[3.2409699419,-1.5373831776,-.4986107603,-.9692436363,1.8759675015,.0415550574,.0556300797,-.2039769589,1.0569715142];
const XYZtoLMS=[.2670502842655792,.8471990148492798,-.03470416612462053,-.38706882411220156,1.165429935890458,.10302286696614202,.026727793989083093,-.02729131667566509,.5333267257603284];
const LMS_TO_BT709=[5.31371789,-4.43611139,.12239350,-.60034891,1.75409022,-.15374131,-.03278170,-.12974283,1.16252453];
const I3=[1,0,0,0,1,0,0,0,1];
const m3v=(m,v)=>[m[0]*v[0]+m[1]*v[1]+m[2]*v[2],m[3]*v[0]+m[4]*v[1]+m[5]*v[2],m[6]*v[0]+m[7]*v[1]+m[8]*v[2]];
function m3mul(a,b){const out=Array(9).fill(0);for(let r=0;r<3;r++)for(let c=0;c<3;c++)for(let k=0;k<3;k++)out[r*3+c]+=a[r*3+k]*b[k*3+c];return out}
function det3(m){return m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6])}
function inv3(m){const [a,b,c,d,e,f,g,h,i]=m,A=e*i-f*h,B=c*h-b*i,C=b*f-c*e,D=f*g-d*i,E=a*i-c*g,F=c*d-a*f,G=d*h-e*g,H=b*g-a*h,I=a*e-b*d,det=a*A+b*D+c*G;if(!Number.isFinite(det)||Math.abs(det)<1e-12)throw Error('Primary transform is singular');return [A/det,B/det,C/det,D/det,E/det,F/det,G/det,H/det,I/det]}
function xyToXYZ(x,y){const yy=Math.abs(y)>1e-12?y:(y<0?-1e-12:1e-12);return [x/yy,1,(1-x-y)/yy]}
function xyzToXy(xyz){const s=xyz[0]+xyz[1]+xyz[2];return Math.abs(s)>1e-12?[xyz[0]/s,xyz[1]/s]:[1/3,1/3]}
function rgb2xyz(p,white){const r=xyToXYZ(...p.r),g=xyToXYZ(...p.g),b=xyToXYZ(...p.b),w=xyToXYZ(...white);const dirs=[r[0],g[0],b[0],r[1],g[1],b[1],r[2],g[2],b[2]];const s=m3v(inv3(dirs),w);return [r[0]*s[0],g[0]*s[1],b[0]*s[2],r[1]*s[0],g[1]*s[1],b[1]*s[2],r[2]*s[0],g[2]*s[1],b[2]*s[2]]}
const V=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const plus=(a,b)=>[a[0]+b[0],a[1]+b[1]];
const mul=(a,k)=>[a[0]*k,a[1]*k];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const len=a=>Math.hypot(...a);
const norm=a=>len(a)>1e-12?mul(a,1/len(a)):[1,0];
function rotate(a,degree){const t=degree*Math.PI/180,c=Math.cos(t),s=Math.sin(t);return [c*a[0]-s*a[1],s*a[0]+c*a[1]]}
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
function barycentric(p,a,b,c){const ab=V(b,a),ac=V(c,a),ap=V(p,a),den=cross(ab,ac);if(Math.abs(den)<1e-12)throw Error('Degenerate gamut triangle');const wb=cross(ap,ac)/den,wc=cross(ab,ap)/den;return [1-wb-wc,wb,wc]}
function constrainWhite(w,p){const original=barycentric(w,p.r,p.g,p.b),weights=original.map(v=>Math.max(v,.01)),sum=weights.reduce((a,b)=>a+b,0),v=weights.map(x=>x/sum);return {point:plus(plus(mul(p.r,v[0]),mul(p.g,v[1])),mul(p.b,v[2])),changed:original.some((x,i)=>Math.abs(x-v[i])>1e-10)}}
function positiveAngle(a,b){let d=Math.atan2(cross(a,b),dot(a,b))*180/Math.PI;return d<0?d+360:d}
function hueLimit(p,w,signedBasis){const d=['r','g','b'].map(k=>norm(V(p[k],w))),gaps=[positiveAngle(d[0],d[1]),positiveAngle(d[1],d[2]),positiveAngle(d[2],d[0])];if(signedBasis){const ang=gaps.map(a=>Math.min(a,360-a));return Math.max(0,Math.min(...ang)*.45)}return Math.max(0,.49*(180-Math.max(...gaps)))}
function rayEdge(w,d,a,b){const e=V(b,a),den=cross(d,e);if(Math.abs(den)<1e-10)return Infinity;const rel=V(a,w),t=cross(rel,e)/den,q=cross(rel,d)/den;return t>0&&q>=0&&q<=1?t:Infinity}
function boundary(w,d,p){const t=Math.min(rayEdge(w,d,p.r,p.g),rayEdge(w,d,p.g,p.b),rayEdge(w,d,p.b,p.r));return Number.isFinite(t)?plus(w,mul(d,t)):w}
function planckXY(k){const T=clamp(k,1667,25000);const x=T<=4000?-0.2661239e9/T**3-0.2343580e6/T**2+.8776956e3/T+.179910:-3.0258469e9/T**3+2.1070379e6/T**2+.2226347e3/T+.240390;let y;if(T<=2222)y=-1.1063814*x**3-1.34811020*x*x+2.18555832*x-.20219683;else if(T<=4000)y=-.9549476*x**3-1.37418593*x*x+2.09137015*x-.16748867;else y=3.081758*x**3-5.87338670*x*x+3.75112997*x-.37001483;return [x,y]}
function xyToUV(xy){const den=-2*xy[0]+12*xy[1]+3;return Math.abs(den)>1e-12?[4*xy[0]/den,6*xy[1]/den]:[0,0]}
function uvToXY(uv){const den=2*uv[0]-8*uv[1]+4;return Math.abs(den)>1e-12?[3*uv[0]/den,2*uv[1]/den]:[1/3,1/3]}
function planckNormal(k){const kel=clamp(k,1667,25000),m=1e6/kel,mw=Math.min(1e6/1667,m+.5),mc=Math.max(1e6/25000,m-.5),warm=xyToUV(planckXY(1e6/mw)),cool=xyToUV(planckXY(1e6/mc)),t=norm(V(cool,warm));return norm([t[1],-t[0]])}
function tempTintXY(k,duv){return uvToXY(plus(xyToUV(planckXY(k)),mul(planckNormal(k),duv)))}
function xyToTempTint(xy){const target=xyToUV(xy);let lo=1e6/25000,hi=1e6/1667;for(let i=0;i<72;i++){const m1=lo+(hi-lo)/3,m2=hi-(hi-lo)/3,u1=xyToUV(planckXY(1e6/m1)),u2=xyToUV(planckXY(1e6/m2));const e1=V(u1,target),e2=V(u2,target);if(dot(e1,e1)<dot(e2,e2))hi=m2;else lo=m1}const k=1e6/((lo+hi)/2),ref=xyToUV(planckXY(k));return [k,dot(V(target,ref),planckNormal(k))]}
const PRESET_WHITE={d65:[.3127,.3290],d60:[.32168,.33767],d55:[.33242,.34743],d50:[.34567,.3585],dci:[.3140,.3510]};
const GAMUTS={bt709:P709,p3:PP3,bt2020:P2020,ap1:PAP1};
function getLMSChromas(){const rgbXyz=m3mul(M709XYZ,LMS_TO_BT709);const axis=k=>xyzToXy([rgbXyz[k],rgbXyz[k+3],rgbXyz[k+6]]);return {r:axis(0),g:axis(1),b:axis(2),w:P709.w}}
GAMUTS.lms=getLMSChromas();
const AUTHOR_IDS=['strength','globalReach','globalHue','rReach','rHue','gReach','gHue','bReach','bHue','outsetR','outsetG','outsetB','outsetRHue','outsetGHue','outsetBHue','temperature','tint'];
const GRADE_IDS=['saturation','highlightSat','dechroma','anchorIn','anchorOut','contrast','deepShadowV2','highlightContrast','shadowContrast','highlights','shadows'];
const PSY_IDS=['psyHighlights','psyShadows','psyContrast','psyPurity','psyConeExponent','psyGamutAmount','psyCompression','psyAnchorIn','psyAnchorOut','psyFitPower'];
const ALL_PAIRS=[...AUTHOR_IDS,...GRADE_IDS,...PSY_IDS];
function controlsPrimary(){return {gamut:$('authorGamut').value,mode:$('transformMode').value,unbounded:$('extrapolate').checked,kelvin:+$('temperature').value,tint:+$('tint').value,strength:+$('strength').value,globalReach:+$('globalReach').value,globalHue:+$('globalHue').value,rReach:+$('rReach').value,rHue:+$('rHue').value,gReach:+$('gReach').value,gHue:+$('gHue').value,bReach:+$('bReach').value,bHue:+$('bHue').value,purity:{r:+$('outsetR').value,g:+$('outsetG').value,b:+$('outsetB').value},outsetHue:{r:+$('outsetRHue').value,g:+$('outsetGHue').value,b:+$('outsetBHue').value}}}
function controlsGrade(){return {saturation:+$('saturation').value,highlightSat:+$('highlightSat').value,dechroma:+$('dechroma').value,anchorIn:+$('anchorIn').value,anchorOut:+$('anchorOut').value,contrast:+$('contrast').value,flare:clamp(+$('deepShadowV2').value,0,1)**5,highlightContrast:+$('highlightContrast').value,shadowContrast:+$('shadowContrast').value,highlights:+$('highlights').value,shadows:+$('shadows').value}}
const AXIS_MIXES={r:[1,0,0],g:[0,1,0],b:[0,0,1],y:[1,1,0],c:[0,1,1],m:[1,0,1]};
const AXIS_COLORS={r:'#ff6262',g:'#62e887',b:'#6d8fff',y:'#f4db4c',c:'#4de3d2',m:'#ed54bf'};
function axisGeometry(matrix){const xyz={r:[matrix[0],matrix[3],matrix[6]],g:[matrix[1],matrix[4],matrix[7]],b:[matrix[2],matrix[5],matrix[8]]};for(const k of ['y','c','m']){const mix=AXIS_MIXES[k];xyz[k]=[0,1,2].map(i=>xyz.r[i]*mix[0]+xyz.g[i]*mix[1]+xyz.b[i]*mix[2])}return {xyz,xy:Object.fromEntries(Object.entries(xyz).map(([k,v])=>[k,xyzToXy(v)]))}}
function buildPrism(){
 const c=controlsPrimary(),base=GAMUTS[c.gamut],isAGX=c.mode==='agx',signedBasis=c.gamut==='lms',allowExtrapolation=c.unbounded;
 const requestedExtrapolation=allowExtrapolation,extendedReach=signedBasis||requestedExtrapolation;
 const requested=tempTintXY(c.kelvin,c.tint),safeWhite=signedBasis?{point:requested,changed:false}:constrainWhite(requested,base),w=safeWhite.point;
 const limit=hueLimit(base,w,signedBasis),hue0=c.globalHue*c.strength,maxReach=extendedReach?2:1;
 const primaryReach=k=>2**(Math.log2(clamp(c.globalReach*c[k+'Reach'],.05,maxReach))*Math.max(0,c.strength));
 const primaryHue=k=>hue0+clamp(c[k+'Hue']*c.strength,-limit,limit);
 function primaryAt(k,hue,reach){if(signedBasis){const d=rotate(V(base[k],w),hue);return plus(w,mul(d,reach))}const d=rotate(norm(V(base[k],w)),hue),tip=boundary(w,d,base);return plus(w,mul(V(tip,w),reach))}
 const xy={r:primaryAt('r',primaryHue('r'),primaryReach('r')),g:primaryAt('g',primaryHue('g'),primaryReach('g')),b:primaryAt('b',primaryHue('b'),primaryReach('b'))};
 function outsetPrimary(k){if(!isAGX)return xy[k];const reach=clamp(1-c.purity[k]*Math.max(0,c.strength),.05,2),hue=hue0+clamp(clamp(c[k+'Hue']*c.strength,-limit,limit)+c.outsetHue[k]*c.strength,-limit,limit);if(signedBasis){const d=rotate(V(base[k],w),hue);return plus(w,mul(d,reach))}const d=rotate(norm(V(base[k],w)),hue),tip=boundary(w,d,base);return plus(w,mul(V(tip,w),reach))}
 const outsetXY={r:outsetPrimary('r'),g:outsetPrimary('g'),b:outsetPrimary('b')};
 const authored=rgb2xyz(xy,w),reference=rgb2xyz(base,w),outsetAuthor=rgb2xyz(outsetXY,w),axes=axisGeometry(authored),referenceAxes=axisGeometry(reference);
 let inset,outset,formationTo709;
 if(isAGX){const x2r=inv3(reference),t709r=m3mul(x2r,M709XYZ),r709=m3mul(MXYZ709,reference);inset=m3mul(m3mul(x2r,authored),t709r);outset=m3mul(r709,m3mul(inv3(outsetAuthor),reference));formationTo709=inv3(inset)}
 else{outset=m3mul(MXYZ709,authored);inset=inv3(outset);formationTo709=outset}
 const yWeights=m3mul(M709XYZ,formationTo709).slice(3,6);
 const neutral=m3v(inset,m3v(MXYZ709,xyToXYZ(...w))),neutralInv=1/(neutral.reduce((s,v,i)=>s+v*yWeights[i],0)||1);
 const w2lms=m3mul(m3mul(XYZtoLMS,M709XYZ),formationTo709),lms2w=m3mul(inset,m3mul(MXYZ709,inv3(XYZtoLMS)));
 return {xy,outsetXY,base,white:w,requestedWhite:requested,whiteConstrained:safeWhite.changed,hueLimit:limit,inset,outset,formationTo709,yWeights,neutral,neutralInv,w2lms,lms2w,isAGX,unbounded:extendedReach,gamut:c.gamut,axes,referenceAxes,referenceXYZ:reference,authoredXYZ:authored,outsetXYZ:outsetAuthor};
}
function validConfig(p){for(const m of [p.inset,p.outset,p.w2lms,p.lms2w])if(m.some(v=>!Number.isFinite(v)))throw Error('Non-finite transform');if(Math.abs(det3(p.inset))<1e-7||Math.abs(det3(p.outset))<1e-7)throw Error('Near-singular transform')}
function setGamut(id){$('authorGamut').value=id;markAuthorCustom();updateAll()}
function setWhitePreset(id){if(!PRESET_WHITE[id])return;const [k,t]=id==='d65'?[6501.7344,.0031730535]:xyToTempTint(PRESET_WHITE[id]);$('temperature').value=k.toFixed(4);$('tint').value=t.toFixed(10);syncAllNumbers();updateAll()}
function resetAuthor(){const values={strength:1,globalReach:1,globalHue:0,rReach:1,rHue:0,gReach:1,gHue:0,bReach:1,bHue:0,outsetR:0,outsetG:0,outsetB:0,outsetRHue:0,outsetGHue:0,outsetBHue:0,temperature:6501.7344,tint:.0031730535};for(const [id,val] of Object.entries(values))$(id).value=val;$('authorGamut').value='bt709';$('transformMode').value='agx';$('extrapolate').checked=false;$('whitePreset').value='d65';$('presetBadge').textContent='BT.709';syncAllNumbers();updateAll()}
const NATURAL_PRIMARIES={rReach:.5375,rHue:4.45,gReach:.605,gHue:4.45,bReach:.6325,bHue:-3.8,outsetR:.435,outsetG:.31,outsetB:.225};
function applyNaturalPrimaries(){resetAuthor();$('authorGamut').value='bt2020';for(const [id,value] of Object.entries(NATURAL_PRIMARIES))$(id).value=value;syncAllNumbers();markAuthorCustom();updateAll()}
function applyAgxLikePrimaries(){resetAuthor();$('authorGamut').value='bt2020';for(const [id,value] of Object.entries({rReach:.67,rHue:2.15,gReach:.72,gHue:-1.25,bReach:.875,bHue:-3.05,outsetR:.33,outsetG:.28,outsetB:.125}))$(id).value=value;syncAllNumbers();markAuthorCustom();updateAll()}
function resetGrade(){const values={saturation:1,highlightSat:1,dechroma:0,anchorIn:.18,anchorOut:.18,contrast:1,deepShadowV2:0,highlightContrast:1,shadowContrast:1,highlights:1,shadows:1};for(const [id,val] of Object.entries(values))$(id).value=val;$('chromaSpace').value='yf';$('contrastMode').value='anchored';syncAllNumbers();updateAll()}
function resetAllTuning(){
 for(const el of document.querySelectorAll('.tuningControls input[id],.tuningControls select[id]')){
  if(el.tagName==='SELECT'){const option=[...el.options].find(o=>o.defaultSelected)||el.options[0];el.value=option.value}
  else if(el.type==='checkbox')el.checked=el.defaultChecked;
  else el.value=el.defaultValue;
 }
 updateReachLimits();syncAllNumbers();markAuthorCustom();updateAll();
}
function applyNaturalPreset(){
 resetAllTuning();
 $('toneMapper').value='0';$('authorGamut').value='bt2020';$('transformMode').value='agx';$('extrapolate').checked=false;
 $('whitePreset').value='d65';$('prismGamut').value='bt709';$('chromaSpace').value='yf';$('contrastMode').value='anchored';
 updateReachLimits();
 for(const [id,value] of Object.entries({...NATURAL_PRIMARIES,saturation:1,highlightSat:1,dechroma:0,highlights:1,highlightContrast:.7575,contrast:1.145,shadowContrast:.7925,shadows:.6625,deepShadowV2:0,anchorIn:.18,anchorOut:.125,exposure:0,compression:2,whiteClip:100}))$(id).value=value;
 syncAllNumbers();
 for(const [slider,number] of [['exposureSlider','exposure'],['compressionSlider','compression'],['whiteClipSlider','whiteClip']])$(slider).value=$(number).value;
 markAuthorCustom();updateAll();
}
function applyAgxLikePreset(){
 resetAllTuning();
 $('toneMapper').value='0';$('authorGamut').value='bt2020';$('transformMode').value='agx';$('extrapolate').checked=false;
 $('whitePreset').value='d65';$('prismGamut').value='bt709';$('chromaSpace').value='yf';$('contrastMode').value='anchored';
 for(const [id,value] of Object.entries({rReach:.67,rHue:2.15,gReach:.72,gHue:-1.25,bReach:.875,bHue:-3.05,outsetR:.33,outsetG:.28,outsetB:.125,saturation:1,highlightSat:1,dechroma:0,highlights:.886,highlightContrast:.71,contrast:1.03,shadowContrast:.56,shadows:.72,deepShadowV2:0,anchorIn:.18,anchorOut:.175,exposure:0,compression:5,whiteClip:7.34}))$(id).value=value;
 updateReachLimits();syncAllNumbers();
 for(const [slider,number] of [['exposureSlider','exposure'],['compressionSlider','compression'],['whiteClipSlider','whiteClip']])$(slider).value=$(number).value;
 markAuthorCustom();updateAll();
}
function markAuthorCustom(){$('presetBadge').textContent=$('authorGamut').selectedOptions[0].textContent}
function syncAllNumbers(){for(const id of ALL_PAIRS){const n=$(id+'N'),r=$(id);if(n&&r)n.value=r.value}}
function updateReachLimits(){const unbounded=$('extrapolate').checked||$('authorGamut').value==='lms';for(const k of ['globalReach','rReach','gReach','bReach']){$(k).max=unbounded?'2':'1';$(k+'N').max=unbounded?'2':'1';if(+$(k).value>+$(k).max){$(k).value=$(k).max;$(k+'N').value=$(k).value}}$('extrapolate').disabled=$('authorGamut').value==='lms';$('outsetGroup').hidden=$('transformMode').value!=='agx'}
function bindPairs(){for(const id of ALL_PAIRS){const r=$(id),n=$(id+'N');r.addEventListener('input',()=>{n.value=r.value;if(AUTHOR_IDS.includes(id)){$('whitePreset').value=['temperature','tint'].includes(id)?'custom':$('whitePreset').value;markAuthorCustom()}updateAll()});n.addEventListener('input',()=>{if(!Number.isFinite(+n.value))return;r.value=clamp(+n.value,+r.min,+r.max);if(AUTHOR_IDS.includes(id)){$('whitePreset').value=['temperature','tint'].includes(id)?'custom':$('whitePreset').value;markAuthorCustom()}updateAll()})}}
const CIE_VIEW={yaw:-.66,pitch:.56,zoom:1};let LAST_CIE_DATA=null;
function bindCIEInteraction(canvas){if(canvas.dataset.orbitBound)return;canvas.dataset.orbitBound='true';let dragging=false,lastX=0,lastY=0,queued=false;const redraw=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;if(LAST_CIE_DATA)drawCIE(LAST_CIE_DATA)})};canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;dragging=true;lastX=event.clientX;lastY=event.clientY;canvas.classList.add('dragging');canvas.setPointerCapture(event.pointerId)});canvas.addEventListener('pointermove',event=>{if(!dragging)return;CIE_VIEW.yaw+=(event.clientX-lastX)*.008;CIE_VIEW.pitch=clamp(CIE_VIEW.pitch+(event.clientY-lastY)*.008,-1.35,1.35);lastX=event.clientX;lastY=event.clientY;redraw()});const stop=()=>{dragging=false;canvas.classList.remove('dragging')};canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);canvas.addEventListener('wheel',event=>{event.preventDefault();CIE_VIEW.zoom=clamp(CIE_VIEW.zoom*Math.exp(-event.deltaY*.001),.55,3);redraw()},{passive:false});canvas.addEventListener('dblclick',()=>{CIE_VIEW.yaw=-.66;CIE_VIEW.pitch=.56;CIE_VIEW.zoom=1;redraw()})}
function xyzToCIEPoint(xyz,white){const sum=xyz[0]+xyz[1]+xyz[2];if(Math.abs(sum)<1e-10)return {x:white[0],y:white[1],Y:0};return {x:xyz[0]/sum,y:xyz[1]/sum,Y:xyz[1]}}
function drawCIE(p){LAST_CIE_DATA=p;const c=$('ciePlot'),ctx=c.getContext('2d'),W=c.width,H=c.height;bindCIEInteraction(c);ctx.fillStyle='#0b0d10';ctx.fillRect(0,0,W,H);
 const xyzPoint=(matrix,rgb)=>xyzToCIEPoint(m3v(matrix,rgb),p.white),steps=[0,.25,.5,.75,1],mesh=[],domain=[];
 for(const [kind,matrix] of [['reference',p.referenceXYZ],['authored',p.authoredXYZ]])for(let axis=0;axis<3;axis++)for(const a of steps)for(const b of steps){const fixed=[0,1,2].filter(i=>i!==axis),path=[];for(let i=0;i<=12;i++){const rgb=[0,0,0];rgb[axis]=i/12;rgb[fixed[0]]=a;rgb[fixed[1]]=b;path.push(xyzPoint(matrix,rgb))}domain.push(...path);mesh.push({kind,axis,path})}
 const flightRows=['r','g','b','y','c','m'].map(k=>{const startAngle=Math.atan2(p.referenceAxes.xy[k][1]-p.white[1],p.referenceAxes.xy[k][0]-p.white[0]),endXY=p.axes.xy[k],endAngle=Math.atan2(endXY[1]-p.white[1],endXY[0]-p.white[0]),angleDelta=Math.atan2(Math.sin(endAngle-startAngle),Math.cos(endAngle-startAngle)),radius=len(V(endXY,p.white)),end=p.axes.xyz[k],path=[];for(let i=0;i<=36;i++){const t=i/36,theta=startAngle+angleDelta*smootherstep(t),r=radius*t;path.push({x:p.white[0]+Math.cos(theta)*r,y:p.white[1]+Math.sin(theta)*r,Y:1+(end[1]-1)*t})}domain.push(...path);return {key:k,path,end:xyzToCIEPoint(end,p.white)}});
 const xmin=Math.min(0,...domain.map(v=>v.x))-.035,xmax=Math.max(.8,...domain.map(v=>v.x))+.035,ymin=Math.min(0,...domain.map(v=>v.y))-.035,ymax=Math.max(.9,...domain.map(v=>v.y))+.035,span=Math.max(xmax-xmin,ymax-ymin,.65),cx=(xmin+xmax)/2,cz=(ymin+ymax)/2,y0=Math.min(0,...domain.map(v=>v.Y))-.025,y1=Math.max(1.05,...domain.map(v=>v.Y))+.025;
 const camera=point=>{const x=(point.x-cx)*2/span,z=(point.y-cz)*2/span,y=(point.Y-y0)/(y1-y0)*1.35,cy=Math.cos(CIE_VIEW.yaw),sy=Math.sin(CIE_VIEW.yaw),cp=Math.cos(CIE_VIEW.pitch),sp=Math.sin(CIE_VIEW.pitch),rx=x*cy+z*sy,rz=-x*sy+z*cy,ry=y*cp-rz*sp,depth=y*sp+rz*cp,scale=Math.min((W-90)/2.8,(H-100)/2.75)*CIE_VIEW.zoom;return {x:W*.5+rx*scale,y:H*.57-ry*scale,depth}};
 const line=(points,{color='#fff',width=2,dash=[],alpha=1}={})=>{if(points.length<2)return;ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();points.forEach((pt,i)=>{const q=camera(pt);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.stroke();ctx.restore()};
 // CIE xy is the horizontal plane; XYZ Y is the vertical coordinate.
 for(let i=0;i<=8;i++){const f=i/8,x=xmin+(xmax-xmin)*f,y=ymin+(ymax-ymin)*f;line([{x,y:ymin,Y:y0},{x,y:ymax,Y:y0}],{color:'#293039',width:1});line([{x:xmin,y,Y:y0},{x:xmax,y,Y:y0}],{color:'#293039',width:1});if(i%2===0){let q=camera({x,y:ymin,Y:y0});ctx.fillStyle='#87929e';ctx.font='15px system-ui';ctx.fillText(x.toFixed(2),q.x-15,q.y+18);q=camera({x:xmin,y,Y:y0});ctx.fillText(y.toFixed(2),q.x-28,q.y+5)}}
 for(let i=0;i<=4;i++){const Y=y0+(y1-y0)*i/4;line([{x:xmin,y:ymin,Y},{x:xmin,y:ymax,Y}],{color:'#343b44',width:1});line([{x:xmin,y:ymin,Y},{x:xmax,y:ymin,Y}],{color:'#343b44',width:1});const q=camera({x:xmin,y:ymin,Y});ctx.fillStyle='#aab3bd';ctx.font='18px system-ui';ctx.fillText('Y '+Math.max(0,Y).toFixed(2),q.x-45,q.y+5)}
 mesh.sort((a,b)=>{const da=a.path.reduce((s,v)=>s+camera(v).depth,0)/a.path.length,db=b.path.reduce((s,v)=>s+camera(v).depth,0)/b.path.length;return da-db});
 for(const row of mesh){const color=row.kind==='reference'?'#aeb7c2':['#ff6868','#69e88b','#7797ff'][row.axis];line(row.path,{color,width:row.kind==='authored'?2.2:1.8,dash:row.kind==='reference'?[5,6]:[],alpha:row.kind==='authored'?.53:.32})}
 if(p.isAGX){const outsetMatrix=rgb2xyz(p.outsetXY,p.white);for(let axis=0;axis<3;axis++)for(const a of [0,1])for(const b of [0,1]){const fixed=[0,1,2].filter(i=>i!==axis),path=[];for(let i=0;i<=16;i++){const rgb=[0,0,0];rgb[axis]=i/16;rgb[fixed[0]]=a;rgb[fixed[1]]=b;path.push(xyzPoint(outsetMatrix,rgb))}line(path,{color:'#93dfbd',width:2,dash:[5,5],alpha:.65})}}
 for(const row of flightRows){const color=AXIS_COLORS[row.key];line(row.path,{color,width:7,alpha:.95});const end=camera(row.end);ctx.fillStyle=color;ctx.beginPath();ctx.arc(end.x,end.y,9,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#0b0d10';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle=color;ctx.font='bold 20px system-ui';ctx.fillText(row.key.toUpperCase(),end.x+11,end.y-9);}
 const white=camera({x:p.white[0],y:p.white[1],Y:1});ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(white.x,white.y,6,0,Math.PI*2);ctx.fill();ctx.fillStyle='#eef1f4';ctx.font='bold 20px system-ui';ctx.fillText('White',white.x+10,white.y-8);
 ctx.fillStyle='#c4ccd5';ctx.font='20px system-ui';ctx.fillText('CIE x',W-80,H-30);ctx.fillText('CIE y',22,H-48);ctx.save();ctx.translate(26,H*.48);ctx.rotate(-Math.PI/2);ctx.fillText('Luminance Y',0,0);ctx.restore();if(p.whiteConstrained){ctx.fillStyle='#ffc989';ctx.fillText('White point constrained to reference hull',W-390,28)}
}
function cinfinityShoulder(x,peak,anchor,compression,whiteClip){const magnitude=Math.abs(x),clip=Math.max(whiteClip,peak+Math.max(peak*1e-6,1e-6));if(magnitude<=anchor)return x;if(magnitude>=clip)return Math.sign(x)*peak;const range=peak-anchor,clipRange=clip-anchor,d=magnitude-anchor,inv=range*(clipRange-d)/((clip-peak)*d),weight=2**(-inv/compression),denom=weight+inv,transition=denom>0?(d/clipRange)*(weight/denom):1;return Math.sign(x)*(magnitude+(peak-clip)*transition)}
// Scalar port of the preview shader's tonal grading; x is a working-space channel.
function curveTonalGrade(x,g,mode){
 const anchorIn=Math.max(g.anchorIn,1e-6),anchorOut=Math.max(g.anchorOut,0),E=1e-9;
 const {contrast,flare,highlightContrast:hContrast,shadowContrast:sContrast,highlights,shadows}=g;
 if(contrast===1&&flare===0&&hContrast===1&&sContrast===1&&highlights===1&&shadows===1&&anchorIn===anchorOut)return x;
 const ax=Math.abs(x);if(ax===0)return 0;
 const normalized=Math.max(ax/anchorIn,E);let contrasted=normalized;
 if(mode==='pow'){
  let exponent=Math.max(contrast,0);
  if(flare>0){const shadowDistance=clamp(1-normalized,0,1),flatWeight=2**(-normalized/Math.max(shadowDistance,E));exponent*=1+flatWeight*flare/(normalized+flare)}
  contrasted=normalized**exponent;
 }else if(contrast!==1||flare>0){
  let exponent=contrast;
  if(flare>0){const shadowDistance=clamp(1-normalized,0,1),flatWeight=2**(-normalized/Math.max(shadowDistance,E));exponent*=1+flatWeight*flare/(normalized+flare)}
  const inputStops=Math.log2(normalized),highStops=Math.max(inputStops,0);let outHigh=highStops;
  if(contrast!==1){const disp=(contrast-1)*highStops,mag=Math.abs(disp);outHigh+=disp/(1+mag*2**(-1/Math.max(mag,E)))}
  contrasted=2**(exponent*Math.min(inputStops,0)+outHigh);
 }
 if(hContrast!==1){const d=Math.max(contrasted-1,0),d2=d*d,flatFactor=(1+d2)*2**(-1/Math.max(d2,E));contrasted+=d*((1+flatFactor)**(.5*(hContrast-1))-1)}
 if(sContrast!==1){const d=clamp(1-contrasted,0,1),d2=d*d,flatFactor=d2*d*2**(1-1/Math.max(d2,E));contrasted*=(1+flatFactor)**(sContrast-1)}
 const transition=x=>{x=clamp(x,0,1);if(x<=0)return 0;if(x>=1)return 1;return 1/(1+2**((1-2*x)/(x*(1-x))))};
 if(highlights!==1||shadows!==1){
  const stops=Math.log2(Math.max(contrasted,E));let disp=0;
  if(highlights!==1){const a=highlights-1;disp+=a*(1.5*Math.abs(a)+.5)*transition((stops-1)/7)}
  if(shadows!==1){const a=shadows-1;disp+=a*(1.5*Math.abs(a)+.5)*transition((-1-stops)/7)}
  contrasted*=2**disp;
 }
 return Math.sign(x)*contrasted*anchorOut;
}
function previewPeak(){const n=Number($('hdrPeakStops').value);return $('outputMode').value==='hdr'?2**clamp(Number.isFinite(n)?n:2.3,0,10):1}
function drawCurve(){
 const c=$('curve'),ctx=c.getContext('2d'),W=c.width,H=c.height;
 const left=70,right=28,top=48,bottom=65,pw=W-left-right,ph=H-top-bottom;
 ctx.fillStyle='#0b0d10';ctx.fillRect(0,0,W,H);
 const g=controlsGrade(),mode=$('contrastMode').value,anchor=Math.max(0,g.anchorOut),peak=Math.max(Math.max(g.anchorOut,1e-6)+1e-6,previewPeak()),comp=Math.max(1,+$('compression').value||1),clip=Math.max(.001,Number($('whiteClip').value)||100),exposure=2**(+$('exposure').value||0);
 const center=Math.max(g.anchorIn,1e-6),minStop=-10,maxStop=Math.max(8,Math.ceil(Math.log2(Math.max(peak*4,g.anchorIn*30,clip)/(exposure*center)))),my=Math.max(1,peak*1.1);
 const map=(x,y)=>[left+(Math.log2(x/center)-minStop)/(maxStop-minStop)*pw,top+ph-y/my*ph];
 ctx.strokeStyle='#31373e';ctx.lineWidth=1;ctx.fillStyle='#9ca6b2';ctx.font='20px system-ui';ctx.textAlign='center';
 for(let stop=minStop;stop<=maxStop;stop+=2){const x=map(center*2**stop,0)[0];ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+ph);ctx.stroke();ctx.fillText(stop===0?'0':(stop>0?'+':'')+stop,x,top+ph+21)}
 ctx.textAlign='right';for(let i=0;i<=5;i++){const y=top+ph-i/5*ph;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left+pw,y);ctx.stroke();ctx.fillText((my*i/5).toPrecision(2),left-10,y+5)}
 ctx.textAlign='center';ctx.fillText('Input exposure (stops relative to input mid-gray)',left+pw/2,H-10);ctx.textAlign='left';ctx.fillText('Linear output',left,25);
 ctx.save();ctx.beginPath();ctx.rect(left,top,pw,ph);ctx.clip();
 const draw=(color,dash,fn,width)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();let started=false;for(let i=0;i<=1400;i++){const x=center*2**(minStop+(maxStop-minStop)*i/1400),y=fn(x);if(!Number.isFinite(y)){started=false;continue}const q=map(x,y);if(started)ctx.lineTo(...q);else{ctx.moveTo(...q);started=true}}ctx.stroke()};
 draw('#69727e',[6,6],x=>x,1.3);
 draw('#ffd59a',[8,6],x=>cinfinityShoulder(x*exposure,peak,anchor,comp,clip),1.8);
 draw('#eef1f4',[],x=>cinfinityShoulder(curveTonalGrade(x*exposure,g,mode),peak,anchor,comp,clip),2.6);
 ctx.restore();ctx.setLineDash([]);ctx.fillStyle='#9ca6b2';ctx.textAlign='right';ctx.fillText(`${mode==='pow'?'POW contrast':'Anchored grading'} · peak ${peak.toFixed(2)} · exposure ${Math.log2(exposure).toFixed(2)} EV`,W-right,25);ctx.textAlign='left';
}
const smootherstep=x=>x*x*x*(x*(x*6-15)+10);
const PRISM_Y_ROLLOFF_STOPS=2.75*Math.log2(10);
function drawPurityPlot(){const c=$('purityPlot'),ctx=c.getContext('2d'),W=c.width,H=c.height,pad=52;ctx.fillStyle='#0b0d10';ctx.fillRect(0,0,W,H);const g=controlsGrade(),ratio=Math.max(previewPeak()/Math.max(g.anchorOut,1e-6),1e-6),maxStops=Math.max(12,PRISM_Y_ROLLOFF_STOPS),map=(x,y)=>[pad+x/maxStops*(W-2*pad),H-pad-y/scaleMax*(H-2*pad)],peakAvailability=1/(1+ratio),rolloff=s=>smootherstep(clamp(s/PRISM_Y_ROLLOFF_STOPS,0,1)),highlightScale=s=>{const r=rolloff(s),h=r*r*(.5*r+.5);return g.saturation*(1+(g.highlightSat-1)*h*(2/3))},blowoutAvailability=s=>1-g.dechroma*rolloff(s)*(1-peakAvailability),scaleMax=Math.max(2.2,g.saturation*Math.max(1,1+(g.highlightSat-1)*(2/3)));for(let i=0;i<=8;i++){const x=pad+(W-2*pad)*i/8;ctx.strokeStyle='#2b3037';ctx.beginPath();ctx.moveTo(x,pad);ctx.lineTo(x,H-pad);ctx.stroke()}for(const [color,fn,dash] of [['#ffd59a',highlightScale,[]],['#88d8b0',blowoutAvailability,[8,6]],['#84a8ff',s=>highlightScale(s)*blowoutAvailability(s),[]]]){ctx.strokeStyle=color;ctx.lineWidth=2.2;ctx.setLineDash(dash);ctx.beginPath();for(let i=0;i<=1000;i++){const q=map(i*maxStops/1000,fn(i*maxStops/1000));i?ctx.lineTo(...q):ctx.moveTo(...q)}ctx.stroke()}ctx.setLineDash([]);ctx.fillStyle='#9ca6b2';ctx.font='20px system-ui';ctx.fillText('Prism XYZ Y · highlight and blowout strength relative to anchor',16,22)}
function fmtM(m){return [0,1,2].map(r=>'  '+m.slice(r*3,r*3+3).map(v=>(v>=0?' ':'')+v.toFixed(9)+'f').join(', ')).join(',\n')}
function updateDiagnostics(p){const xyArea=o=>Math.abs(cross(V(o.g,o.r),V(o.b,o.r)))/2;const inside=Object.values(p.xy).every(v=>barycentric(v,p.base.r,p.base.g,p.base.b).every(x=>x>=-1e-6));const badges=[['Reference gamut',p.gamut.toUpperCase()],['Authoring mode',p.isAGX?'AgX-style':'Working basis'],['Primary locations',inside?'Inside reference hull':'Outside reference hull'],['White (xy)',p.white.map(x=>x.toFixed(6)).join(', ')],['White was constrained',p.whiteConstrained?'Yes':'No'],['Per-primary hue limit',p.hueLimit.toFixed(2)+'°'],['Inset determinant',det3(p.inset).toFixed(6)],['Outset determinant',det3(p.outset).toFixed(6)],['Area vs BT.709',(xyArea(p.xy)/xyArea(P709)).toFixed(3)+'×']];$('diagnostics').replaceChildren(...badges.map(([k,v])=>{const row=document.createElement('div');row.className='metric';const a=document.createElement('span');a.textContent=k;const b=document.createElement('b');b.textContent=v;row.append(a,b);return row}));$('primaryTable').innerHTML=[['r','Red'],['g','Green'],['b','Blue']].map(([k,name])=>`<tr><td>${name}</td><td>${p.xy[k][0].toFixed(6)}</td><td>${p.xy[k][1].toFixed(6)}</td><td>${p.outsetXY[k][0].toFixed(6)}</td><td>${p.outsetXY[k][1].toFixed(6)}</td></tr>`).join('');const names={r:'Red',g:'Green',b:'Blue',y:'Yellow',c:'Cyan',m:'Magenta'};$('axisTable').innerHTML=['r','g','b','y','c','m'].map(k=>{const actual=xyzToXy(p.axes.xyz[k]);return `<tr><td>${names[k]}</td><td>${actual[0].toFixed(5)}</td><td>${actual[1].toFixed(5)}</td><td>${p.axes.xyz[k][1].toFixed(4)}</td></tr>`}).join('')}

function updateHlsl(p){const g=controlsGrade();$('matrixText').textContent=`// Prism CIE 1931 xy authoring — ${p.isAGX?'AgX-inspired independent inset/outset':'Working basis'}\n// Reference: ${p.gamut}, white xy: ${p.white.map(x=>x.toFixed(8)).join(', ')}\n// Pre-tone formation (BT.709 → formation)\nstatic const float3x3 PRISM_INSET = {\n${fmtM(p.inset)}\n};\n\n// Inset working RGB → XYZ (inverse inset, then BT.709 → XYZ)\nstatic const float3x3 PRISM_INSET_TO_XYZ = {\n${fmtM(m3mul(M709XYZ,p.formationTo709))}\n};\n\n// Post-tone formation (formation → BT.709)\nstatic const float3x3 PRISM_OUTSET = {\n${fmtM(p.outset)}\n};\n\n// XYZ Y weights (formation basis): ${p.yWeights.map(v=>v.toFixed(9)).join(', ')}\n// Neutral axis: ${p.neutral.map(v=>v.toFixed(9)).join(', ')}\n// 1 / neutral XYZ Y: ${p.neutralInv.toFixed(9)}\n// Prism grading: ${Object.entries(g).map(([k,v])=>k+'='+v).join(', ')}\n// chroma basis=${$('chromaSpace').value}\n// contrast function=${$('contrastMode').value}\n// Peak=${previewPeak().toFixed(6)} (relative to diffuse white), compression=${$('compression').value}, white clip=${$('whiteClip').value}`}
function updateToneVisibility(){const tone=Number($('toneMapper').value);for(const el of document.querySelectorAll('.prismOnly'))el.hidden=tone!==0;$('prismCompressionControl').hidden=tone!==0;$('hableControls').hidden=tone!==1;$('psychoControls').hidden=tone!==5;const hdr=$('outputMode').value==='hdr';$('hdrPeakControl').hidden=!hdr||tone===3||tone===4;}
function updateAll(){try{updateToneVisibility();updateReachLimits();const p=buildPrism();validConfig(p);updateDiagnostics(p);drawCIE(p);drawPurityPlot();drawCurve();updateHlsl(p);$('solverStatus').textContent='';$('solverStatus').className='good';if(window.updatePrismPreview)window.updatePrismPreview()}catch(e){$('solverStatus').textContent='Invalid authoring configuration: '+(e.message||e);$('solverStatus').className='bad';$('diagnostics').textContent=e.message||String(e);$('matrixText').textContent='Invalid primary configuration';console.warn(e)}}
bindPairs();syncAllNumbers();
// Reset each slider through its normal input handler so paired fields and plots stay in sync.
for(const slider of document.querySelectorAll('input[type="range"]')) {
 const button=document.createElement('button'); button.type='button'; button.className='resetSlider'; button.textContent='↺';
 const label=slider.labels?.[0]?.textContent?.trim() || slider.closest('label')?.textContent?.trim() || slider.id;
 button.title='Reset '+label; button.setAttribute('aria-label','Reset '+label);
 slider.insertAdjacentElement('afterend',button);
 button.addEventListener('click',()=>{slider.value=slider.defaultValue;slider.dispatchEvent(new Event('input',{bubbles:true}));});
}
for(const [rangeId,numberId] of [['hableWhiteSlider','hableWhite'],['peakSlider','peak'],['hdrPeakStopsSlider','hdrPeakStops'],['exposureSlider','exposure'],['compressionSlider','compression'],['whiteClipSlider','whiteClip']]) {
 const r=$(rangeId),n=$(numberId);
 r.addEventListener('input',()=>{n.value=r.value; n.dispatchEvent(new Event('input',{bubbles:true}));});
 n.addEventListener('input',()=>{if(n.value!=='' && Number.isFinite(+n.value))r.value=clamp(+n.value,+r.min,+r.max);});
}
$('authorGamut').addEventListener('change',()=>{updateReachLimits();markAuthorCustom();updateAll()});
$('whitePreset').addEventListener('change',()=>setWhitePreset($('whitePreset').value));
for(const id of ['toneMapper','psyTarget','psyFit','psyConditioning','transformMode','extrapolate','chromaSpace','contrastMode'])$(id).addEventListener('change',()=>{updateReachLimits();updateAll()});
for(const b of document.querySelectorAll('[data-gamut]'))b.addEventListener('click',()=>setGamut(b.dataset.gamut));
for(const b of document.querySelectorAll('.resetPrimary'))b.addEventListener('click',()=>{const k=b.dataset.p;$(k+'Reach').value=1;$(k+'Hue').value=0;syncAllNumbers();updateAll()});
$('exampleNatural').onclick=applyNaturalPrimaries;$('exampleAgxLike').onclick=applyAgxLikePrimaries;$('resetAuthor').onclick=resetAuthor;$('resetGrade').onclick=resetGrade;
$('presetNatural').onclick=applyNaturalPreset;$('presetAgxLike').onclick=applyAgxLikePreset;$('resetAll').onclick=resetAllTuning;
for(const id of ['exposure','peak','compression','hdrPeakStops','hableWhite','whiteClip'])$(id).addEventListener('input',updateAll);
$('copyHlsl').onclick=async()=>{await navigator.clipboard.writeText($('matrixText').textContent);$('copyHlsl').textContent='Copied';setTimeout(()=>$('copyHlsl').textContent='Copy HLSL',900)};
setWhitePreset('d65');
