import { DampedSpring } from './damped-spring';

/** Small authored-mouth reactions; no cheek/jaw geometry is synthesized here. */
export class ExpressiveRebound {
  private smile=new DampedSpring();
  private mouth=new DampedSpring();
  private greeting=-1;
  private manualGreeting=false;

  trigger():void { this.greeting=0;this.manualGreeting=true; }
  reset():void { this.smile.reset();this.mouth.reset();this.greeting=-1;this.manualGreeting=false; }

  update(dt:number,automaticSmile:number,enabled:boolean):Record<string,number> {
    const seconds=Number.isFinite(dt)?Math.max(0,Math.min(.1,dt)):0;
    // A manual greeting is an explicit request even when a selected expression
    // suppresses autonomous face cues. Keep its queued response and spring tail.
    if(!enabled&&!this.manualGreeting){this.reset();return {};}
    if(this.greeting>=0&&seconds>0){this.greeting+=seconds;if(this.greeting>1.1)this.greeting=-1;}
    const greeting=this.greeting>=0?.48*Math.sin(Math.PI*this.greeting/1.1)**2:0;
    // Automatic cues include the sparse Neutral microexpression as well as
    // the larger autonomous gesture cue. Keep both below a manual greeting;
    // a short spring tail makes the face read as a feline flicker rather than
    // a permanently painted smile.
    const automatic=enabled?Math.min(.22,Math.max(0,Number.isFinite(automaticSmile)?automaticSmile:0)*1.35):0;
    const target=Math.min(.58,Math.max(automatic,greeting));
    const smile=Math.max(0,Math.min(.65,this.smile.update(target,seconds,4.5,.64)));
    const mouth=Math.max(0,Math.min(.16,this.mouth.update(target*.22,seconds,5.8,.58)));
    if(smile<1e-5&&mouth<1e-5){
      if(this.greeting<0)this.manualGreeting=false;
      return {};
    }
    return {
      ParamMouthForm:smile,ParamMouthOpenY:mouth,
      ParamCheekPuff:smile*.72,
      ParamEyeLSmile:smile*.42,ParamEyeRSmile:smile*.4,
      ParamBrowLY:smile*.13,ParamBrowRY:smile*.11,
      ParamEarLTwitch:smile*.25,ParamEarRTwitch:smile*.2,
    };
  }
}
