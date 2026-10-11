import { loadTesseract, type OcrWord } from './financeScreenshotOcr';

export interface AlipayOcrImage { name: string; width: number; height: number; words: OcrWord[]; text: string }

export async function readAlipayScreenshots(files: File[], progress: (message: string) => void, signal?: AbortSignal): Promise<AlipayOcrImage[]> {
  if (!files.length || files.length > 20) throw new Error('每次请选择 1–20 张截图');
  if (files.some((file) => !/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 20_000_000)) throw new Error('请选择 20 MB 以内的 PNG、JPEG 或 WebP 截图');
  const interrupted = () => new Error('识别已取消');
  const wait = <T,>(task: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const abort = () => finish(() => reject(interrupted()));
    const timer = setTimeout(() => finish(() => reject(new Error('图片识别超时，请检查网络或减少截图后重试'))), 120_000);
    const finish = (done: () => void) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); done(); };
    task.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
  if (signal?.aborted) throw interrupted();
  progress('加载图片识别');
  const runtime = await wait(loadTesseract());
  let expired = false;
  const creating = runtime.createWorker('chi_sim+eng', 1).then((worker) => {
    if (expired || signal?.aborted) void worker.terminate();
    return worker;
  });
  const worker = await wait(creating).catch((error) => { expired = true; throw error; });
  try {
    await wait(worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' }));
    const result: AlipayOcrImage[] = [];
    for (let i = 0; i < files.length; i++) {
      if (signal?.aborted) throw interrupted();
      progress(`识别截图 ${i + 1}/${files.length}`);
      const bitmap = await createImageBitmap(files[i]);
      try {
        if (bitmap.width * bitmap.height > 40_000_000) throw new Error('截图过长，请分成几张上传');
        const scale = Math.min(2, Math.max(1, 1080 / bitmap.width), Math.sqrt(40_000_000 / (bitmap.width * bitmap.height)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法读取图片');
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const { data } = await wait(worker.recognize(canvas, {}, { text: true, blocks: true }));
        const words = data.words ?? data.blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words))) ?? [];
        result.push({ name: `${files[i].name}（${i + 1}）`, width: canvas.width, height: canvas.height,
          words: words.map(({ text, confidence, bbox }) => ({ text, confidence, bbox })), text: data.text });
        canvas.width = canvas.height = 0;
      } finally { bitmap.close(); }
    }
    return result;
  } finally { await worker.terminate(); }
}
