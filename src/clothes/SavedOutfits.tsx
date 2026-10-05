import type { ClothesDayContext, ClothesItem, WearRecord } from './types';
import { wearId } from './types';
import { photoUrl } from './client';
import { weatherFor } from './rules';
import { wearable } from './warmth';
import { createWearDraft, type WearDraft } from './WearEditor';
import OutfitWarmth from './OutfitWarmth';

export default function SavedOutfits({ outfits, items, context, onOpenWear, hasWearDraft }: {
  outfits: WearRecord[]; items: ClothesItem[]; context: ClothesDayContext;
  onOpenWear: (draft: WearDraft) => void; hasWearDraft: boolean;
}) {
  return <section className="clothes-today-records" aria-label="保存的搭配">
    <div className="clothes-row clothes-section-heading"><h2>搭配 · {outfits.length} 套</h2><button className="life-primary" onClick={() => onOpenWear(createWearDraft(context, weatherFor(context, null)))}>{hasWearDraft ? '继续记录' : '记录穿搭'}</button></div>
    {outfits.length ? [...outfits].sort((a, b) => b.date.localeCompare(a.date) || b.confirmedAt.localeCompare(a.confirmedAt)).map((outfit) => {
      const pieces = outfit.items.map((piece) => items.find((item) => item.id === piece.id && wearable(item)));
      const available = pieces.every((piece) => !!piece);
      return <article className="clothes-daily-record" key={wearId(outfit)}>
        <div className="clothes-row"><strong>{outfit.date}{outfit.purpose ? ` · ${outfit.purpose}` : ''}</strong><button className="clothes-link" onClick={() => onOpenWear(createWearDraft(context, null, [], outfit))}>编辑穿搭</button></div>
        <div className="clothes-history-pieces">{outfit.items.map((item) => <figure key={item.id}><img loading="lazy" src={photoUrl(item.photoId)} alt={item.name} /><figcaption>{item.name}</figcaption></figure>)}</div>
        <OutfitWarmth items={outfit.items} indoorCoat={outfit.indoorCoat} indoorOnly={outfit.purpose === '睡觉'} />
        <div className="clothes-row">{!available ? <span className="clothes-muted">部分衣物不可穿</span> : <span />}<button className="clothes-save" disabled={!available} onClick={() => onOpenWear({
          ...createWearDraft(context, weatherFor(context, null), pieces as ClothesItem[]),
          purpose: outfit.purpose ?? '', indoorCoat: outfit.indoorCoat ?? false,
        })}>穿这套</button></div>
      </article>;
    }) : <p className="clothes-muted">还没有保存的搭配</p>}
  </section>;
}
