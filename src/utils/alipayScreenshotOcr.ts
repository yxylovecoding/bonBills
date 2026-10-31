import { loadTesseract, type OcrPage, type OcrWord } from './financeScreenshotOcr';

export interface AlipayOcrImage {
  name: string; width: number; height: number; words: OcrWord[]; text: string;
  fallback?: { words: OcrWord[]; text: string };
}
const pageWords = (data: OcrPage) =>
  (data.words ?? data.blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words))) ?? [])
    .map(({ text, confidence, bbox }) => ({ text, confidence, bbox }));

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
    // List screenshots have aligned rows; sparse-text mode can discard whole names.
    await wait(worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' }));
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
        let { data } = await wait(worker.recognize(canvas, {}, { text: true, blocks: true }));
        const text = data.text.replace(/\s/g, '');
        const detail = /资产详情|买入产品|卖出产品/.test(text);
        let fallback: AlipayOcrImage['fallback'];
        // Sparse layout still helps on detail pages and names misread in an aligned list.
        const croppedOrders = /定投|买入|卖出|赎回/.test(text) && /(?:19|20)\d{2}-\d{2}-\d{2}[012]\d:[0-5]\d:[0-5]\d/.test(text);
        if (detail || croppedOrders || /交易记录|我的持有|我的黄金基金|持有收益/.test(text)) {
          await wait(worker.setParameters({ tessedit_pageseg_mode: '11' }));
          try {
            const alternate = (await wait(worker.recognize(canvas, {}, { text: true, blocks: true }))).data;
            if (detail) data = alternate;
            else fallback = { text: alternate.text, words: pageWords(alternate) };
          }
          finally { await wait(worker.setParameters({ tessedit_pageseg_mode: '6' })); }
        }
        result.push({ name: `截图 ${i + 1}`, width: canvas.width, height: canvas.height,
          words: pageWords(data), text: data.text, ...(fallback ? { fallback } : {}) });
        canvas.width = canvas.height = 0;
      } finally { bitmap.close(); }
    }
    return result;
  } finally { await worker.terminate(); }
}
