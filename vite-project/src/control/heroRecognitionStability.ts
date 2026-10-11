export interface HeroRecognitionStability {
  phaseKey:string;
  heroId:number | null;
  count:number;
}

export interface HeroCandidate {
  heroId:number;
  confidence:number;
}

export interface StableHeroResult {
  stability:HeroRecognitionStability;
  accepted:boolean;
  top?:HeroCandidate;
  margin:number;
  requiredScans:number;
}

export const HERO_HIGH_CONFIDENCE=.65;
export const HERO_MEDIUM_CONFIDENCE=.55;

function requiredScans(confidence:number, margin:number) {
  if(confidence>=HERO_HIGH_CONFIDENCE && margin>=.060) return 2;
  if(confidence>=HERO_MEDIUM_CONFIDENCE && margin>=.060) return 3;
  return 0;
}

export function updateHeroRecognitionStability(
  previous:HeroRecognitionStability,
  phaseKey:string,
  candidates:HeroCandidate[],
):StableHeroResult {
  const top=candidates[0];
  const second=candidates[1];
  const margin=top ? top.confidence-(second?.confidence ?? 0) : 0;
  const required=top ? requiredScans(top.confidence,margin) : 0;

  if(!top || required===0) {
    return {
      stability:{phaseKey,heroId:null,count:0},
      accepted:false,
      top,
      margin,
      requiredScans:0,
    };
  }

  const same=previous.phaseKey===phaseKey&&previous.heroId===top.heroId;
  const stability={
    phaseKey,
    heroId:top.heroId,
    count:same?previous.count+1:1,
  };

  return {
    stability,
    accepted:stability.count>=required,
    top,
    margin,
    requiredScans:required,
  };
}
