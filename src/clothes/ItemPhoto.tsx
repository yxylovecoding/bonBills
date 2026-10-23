import { useState } from 'react';
import { photoUrl } from './client';
import type { ClothesItem } from './types';

// Historical snapshots keep their original status; use the live wardrobe to
// decide whether an image request needs an explicit click.
export default function ItemPhoto({ item, current }: { item: ClothesItem; current?: ClothesItem }) {
  const [revealed, setRevealed] = useState('');
  const identity = `${item.id}:${item.photoId}:${current?.revision ?? item.revision}`;
  if ((current ?? item).status === '已丢弃' && revealed !== identity) {
    return <button type="button" className="clothes-photo-placeholder" aria-label={`查看${item.name}的照片`} onClick={() => setRevealed(identity)}><span>已丢弃</span><span>查看照片</span></button>;
  }
  return <img loading="lazy" src={photoUrl(item.photoId)} alt={item.name} />;
}
