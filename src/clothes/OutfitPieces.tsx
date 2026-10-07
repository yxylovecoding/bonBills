import { photoUrl } from './client';
import { categoryLabel, type Category, type ClothesItem } from './types';

export default function OutfitPieces({ items, onReplace, fixed = [], onUnpin, onRemove, onAddLayer }: {
  items: ClothesItem[]; onReplace: (item: ClothesItem) => void; fixed?: ClothesItem[];
  onUnpin?: (item: ClothesItem) => void; onRemove?: (item: ClothesItem) => void;
  onAddLayer?: (category: Category) => void;
}) {
  return <div className="clothes-grid clothes-outfit-grid">{items.map((item, index) => <article className="clothes-card" key={item.id}>
    <button type="button" className="clothes-piece-photo" aria-label={`替换${item.name}`} onClick={() => onReplace(item)}><img loading="lazy" src={photoUrl(item.photoId)} alt={item.name} /></button>
    <div className="clothes-card-caption"><div><strong>{item.name}</strong><span>{categoryLabel(item.category)}</span></div>
      {onAddLayer && items.findIndex((piece) => categoryLabel(piece.category) === categoryLabel(item.category)) === index
        && <button type="button" className="clothes-layer-add" aria-label={`叠穿${categoryLabel(item.category)}`} title={`叠穿${categoryLabel(item.category)}`} onClick={() => onAddLayer(item.category)}>＋</button>}
      {fixed.some((piece) => piece.id === item.id) && onUnpin && <button type="button" className="clothes-pinned" aria-label={`取消固定${item.name}`} onClick={() => onUnpin(item)}>已选 ×</button>}
      {onRemove && <button type="button" aria-label={`移除${item.name}`} onClick={() => onRemove(item)}>移除</button>}
    </div>
  </article>)}</div>;
}
