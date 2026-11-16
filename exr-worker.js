import { EXRLoader } from './EXRLoader.js';
import { FloatType } from './three.core.js';
self.onmessage = async ({data}) => {
  try {
    const bytes = await data.file.arrayBuffer();
    const result = new EXRLoader().setDataType(FloatType).parse(bytes);
    const {width,height,header} = result;
    if (!width || !height || width > 32768 || height > 32768) throw Error('Invalid image dimensions');
    const named = header.channels.filter(c => ['R','G','B','A','Y'].includes(c.name));
    if (new Set(named.map(c => c.pixelType)).size > 1 || named.some(c => c.xSampling !== 1 || c.ySampling !== 1)) throw Error('Mixed pixel types or subsampled color channels are not supported in the browser decoder.');
    const limit = Math.min(data.maxSize || 4096,4096), factor = Math.min(1,limit/Math.max(width,height)), w = Math.max(1,Math.round(width*factor)), h = Math.max(1,Math.round(height*factor));
    const rgba = new Float32Array(w*h*4), input=result.data;
    // EXRLoader returns bottom-up pixels; Prism's texture path expects top-down.
    for(let y=0;y<h;y++){const sy=height-1-Math.min(height-1,Math.floor(y/factor));for(let x=0;x<w;x++){const sx=Math.min(width-1,Math.floor(x/factor)),a=(sy*width+sx)*4,b=(y*w+x)*4;rgba[b]=input[a];rgba[b+1]=input[a+1];rgba[b+2]=input[a+2];rgba[b+3]=input[a+3]}}
    const c=header.chromaticities,metadata={};if(c)metadata.chromaticities=[c.redX,c.redY,c.greenX,c.greenY,c.blueX,c.blueY,c.whiteX,c.whiteY];
    if(header.adoptedNeutral)metadata.adoptedNeutral=header.adoptedNeutral;
    if(typeof header.colorInteropID==='string')metadata.colorInteropID=header.colorInteropID;
    if(header.acesImageContainerFlag===1)metadata.acesImageContainerFlag=1;
    self.postMessage({id:data.id,width:w,height:h,originalWidth:width,originalHeight:height,metadata,pixels:rgba},[rgba.buffer]);
  } catch(e) { self.postMessage({id:data.id,error:e.message||String(e)}); }
};
