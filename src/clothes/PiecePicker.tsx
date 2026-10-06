import { useMemo, useState } from 'react';
import { photoUrl } from './client';
import { pairingScore } from './pairing';
import { categoryLabel, type ClothesItem, type PairCounts } from './types';

export default function PiecePicker({ previous, choices, selected, pairCounts, onSelect, onClose }: {
  previous: ClothesItem; choices: ClothesItem[]; selected: ClothesItem[]; pairCounts: PairCounts;
  onSelect: (item: ClothesItem) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const ranked = useMemo(() => choices.filter((item) => item.name.includes(query.trim()))
    .map((item) => ({ item, score: pairingScore(item, selected.filter((piece) => piece.id !== previous.id), pairCounts) }))
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, 'zh-CN')), [choices, query, selected, previous.id, pairCounts]);
  return <section className="clothes-replacements" aria-label={`替换${categoryLabel(previous.category)}`}>
    <div className="clothes-row"><strong>替换{categoryLabel(previous.category)}</strong><button type="button" onClick={onClose}>收起</button></div>
    <div className="clothes-fields clothes-picker-controls"><label className="clothes-full">搜索衣物<input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="衣物名称" /></label></div>
    <div className="clothes-grid clothes-picker-grid">{ranked.map(({ item, score }) => <button type="button" className="clothes-card" key={item.id} aria-label={`换成${item.name}`} onClick={() => onSelect(item)}>
      <img loading="lazy" src={photoUrl(item.photoId)} alt="" /><div className="clothes-card-caption"><strong>{item.name}</strong>{score > 0 && <span>常搭</span>}</div>
    </button>)}</div>
    {!ranked.length && <p className="clothes-muted">暂无可替换衣物</p>}
  </section>;
}
