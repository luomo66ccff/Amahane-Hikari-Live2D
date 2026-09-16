import type { CubismModel } from '@framework/model/cubismmodel';

export type ModelBounds = {left:number;right:number;bottom:number;top:number};
const clamp=(value:number,low:number,high:number)=>Math.max(low,Math.min(high,value));
const smoothstep=(low:number,high:number,value:number)=>{
  const t=clamp((value-low)/(high-low),0,1);
  return t*t*(3-2*t);
};

/** Binocular gaze correction; the model supplies all head and body geometry. */
export class HikariPresentation {
  private native:Float32Array[];
  private originalDirty:CubismModel['getDrawableDynamicFlagVertexPositionsDidChange'];
  private eyeX:number;
  private eyeY:number;
  private eyes:{iris:number[];mask:number;open:number}[];
  private applied=false;
  private rawNativeGaze=false;
  bounds:ModelBounds;
  gazeOrigin:{x:number;y:number};
  headBoundaryY:number;

  constructor(private model:CubismModel,private base:ModelBounds){
    const drawables=new Map<string,number>(),parameters=new Map<string,number>();
    for(let i=0;i<model.getDrawableCount();i++)drawables.set(model.getDrawableId(i).getString(),i);
    for(let i=0;i<model.getParameterCount();i++)parameters.set(model.getParameterId(i).getString(),i);
    const requireIndex=(map:Map<string,number>,name:string)=>{
      const index=map.get(name);
      if(index===undefined)throw new Error('模型姿态资源未能完整读取，请重新加载。');
      return index;
    };
    this.eyeX=requireIndex(parameters,'ParamEyeBallX');
    this.eyeY=requireIndex(parameters,'ParamEyeBallY');
    this.eyes=['L','R'].map(side=>({
      iris:['IrisOriginal_','IrisHidden_'].map(prefix=>requireIndex(drawables,prefix+side)),
      mask:requireIndex(drawables,'EyeWhite_'+side),
      open:requireIndex(parameters,'ParamEye'+side+'Open'),
    }));
    this.native=Array.from({length:model.getDrawableCount()},(_,i)=>new Float32Array(model.getDrawableVertices(i)));
    this.bounds={...base};
    this.gazeOrigin={x:(base.left+base.right)/2,y:base.bottom+(base.top-base.bottom)*.8};
    this.headBoundaryY=base.bottom+(base.top-base.bottom)*.69;
    this.originalDirty=model.getDrawableDynamicFlagVertexPositionsDidChange;
    // Core's dirty flags describe its own vertices. Masks must also upload
    // our final, deformed positions, including while the model is paused.
    model.getDrawableDynamicFlagVertexPositionsDidChange=()=>true;
  }

  setRawNativeGaze(value:boolean):void {
    this.rawNativeGaze=value;
  }

  isRawNativeGaze():boolean {
    return this.rawNativeGaze;
  }

  private restoreNative():void {
    if(!this.applied)return;
    for(let i=0;i<this.native.length;i++)this.model.getDrawableVertices(i).set(this.native[i]);
    this.applied=false;
  }

  update():void {
    const model=this.model;
    this.restoreNative();
    // Only the left iris is bound to these parameters in the supplied moc.
    // Render both at neutral gaze, then apply one shared binocular offset.
    // Keep the actual values (including expression offsets) visible to callers.
    const eyeX=model.getParameterValueByIndex(this.eyeX),eyeY=model.getParameterValueByIndex(this.eyeY);
    if(this.rawNativeGaze){
      model.update();
    }else{
      model.setParameterValueByIndex(this.eyeX,0);
      model.setParameterValueByIndex(this.eyeY,0);
      try{model.update();}
      finally{
        model.setParameterValueByIndex(this.eyeX,eyeX);
        model.setParameterValueByIndex(this.eyeY,eyeY);
      }
    }
    for(let i=0;i<this.native.length;i++)this.native[i].set(model.getDrawableVertices(i));
    if(!this.rawNativeGaze){
      const gx=eyeX/.88,gy=eyeY/.85,ellipse=Math.max(1,Math.hypot(gx,gy));
      for(const eye of this.eyes){
        const opening=smoothstep(.05,.25,model.getParameterValueByIndex(eye.open));
        const dx=gx/ellipse*.006*opening,dy=gy/ellipse*.003*opening;
        for(const index of eye.iris){
          const vertices=model.getDrawableVertices(index);
          for(let j=0;j<vertices.length;j+=2){vertices[j]+=dx;vertices[j+1]+=dy;}
        }
      }
    }
    const bounds={left:Infinity,right:-Infinity,bottom:Infinity,top:-Infinity};
    for(let i=0;i<this.native.length;i++){
      const vertices=model.getDrawableVertices(i),visible=model.getDrawableOpacity(i)>.05;
      for(let j=0;j<vertices.length;j+=2){
        if(visible){
          bounds.left=Math.min(bounds.left,vertices[j]);bounds.right=Math.max(bounds.right,vertices[j]);
          bounds.bottom=Math.min(bounds.bottom,vertices[j+1]);bounds.top=Math.max(bounds.top,vertices[j+1]);
        }
      }
    }
    this.bounds=bounds;
    let x=0,y=0,count=0;
    for(const eye of this.eyes){
      const vertices=model.getDrawableVertices(eye.mask);
      for(let j=0;j<vertices.length;j+=2){x+=vertices[j];y+=vertices[j+1];count++;}
    }
    this.gazeOrigin={x:x/count,y:y/count};
    this.headBoundaryY=this.base.bottom+(this.base.top-this.base.bottom)*.69;
    this.applied=true;
  }

  destroy():void {
    this.restoreNative();
    this.model.getDrawableDynamicFlagVertexPositionsDidChange=this.originalDirty;
    this.native=[];
  }
}
