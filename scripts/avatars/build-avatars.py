"""下載候選人照片並裁成「頭＋一點點肩」的方形 webp。

用法：python3 scripts/avatars/build-avatars.py <jobs.json>
jobs.json：[{ code, name, url, licence, attribution, source_url }]

裁切基準是 public/avatars/TPE-MAYOR-001.webp：臉的高度約佔畫面 57%，
臉中心落在水平 51%、垂直 53% 的位置。用 YuNet 找臉後照這個比例回推方框；
找不到臉就退回「直式照從頂端往下 6%」的保守裁法。
"""
import json, subprocess, sys, os, math
import cv2, numpy as np

OUT = 'public/avatars'
CACHE = os.environ.get('AVATAR_CACHE', 'node_modules/.cache/avatars')
MODEL = os.environ.get('YUNET_MODEL', os.path.join(CACHE, 'yunet.onnx'))
MODEL_URL = 'https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx'
FACE_H, FACE_CX, FACE_CY = 0.57, 0.51, 0.53

def ensure_model():
    if not os.path.exists(MODEL):
        subprocess.run(['curl', '-sL', '-m', '120', '-o', MODEL, MODEL_URL], check=True)
    return cv2.FaceDetectorYN_create(MODEL, '', (320, 320), 0.6)

def flatten(img):
    """去背的 PNG／WebP 有 alpha，直接丟掉會變成黑底；先疊到白底上。"""
    if img.ndim == 3 and img.shape[2] == 4:
        alpha = img[:, :, 3:4].astype(np.float32) / 255.0
        rgb = img[:, :, :3].astype(np.float32)
        img = (rgb * alpha + 255.0 * (1.0 - alpha)).round().astype(np.uint8)
    elif img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    return img


def biggest_face(det, img):
    h, w = img.shape[:2]
    det.setInputSize((w, h))
    _, faces = det.detect(img)
    if faces is None or not len(faces): return None
    return max(faces, key=lambda r: r[2] * r[3])[:4]

def crop(img, face):
    h, w = img.shape[:2]
    if face is None:
        side = min(w, h)
        top = min(int(h * 0.06), h - side) if h > w else (h - side) // 2
        return img[top:top + side, (w - side) // 2:(w - side) // 2 + side]
    fx, fy, fw, fh = face
    side = int(round(fh / FACE_H))
    side = max(16, min(side, w, h))
    cx, cy = fx + fw / 2, fy + fh / 2
    left = int(round(cx - FACE_CX * side))
    top = int(round(cy - FACE_CY * side))
    left = max(0, min(left, w - side))
    top = max(0, min(top, h - side))
    return img[top:top + side, left:left + side]

def main(path):
    os.makedirs(CACHE, exist_ok=True)
    det = ensure_model()
    jobs = json.load(open(path, encoding='utf-8'))
    done, failed, noface = [], [], []
    for j in jobs:
        ext = os.path.splitext(j['url'].split('?')[0])[1][:5] or '.jpg'
        cached = os.path.join(CACHE, j['code'] + ext)
        try:
            if not os.path.exists(cached):
                subprocess.run(['curl', '-sL', '-m', '60', '-A', 'Mozilla/5.0', '-o', cached, j['url']], check=True)
            img = cv2.imread(cached, cv2.IMREAD_UNCHANGED)
            if img is None: raise ValueError('讀不到圖片')
            img = flatten(img)
            face = biggest_face(det, img)
            if face is None: noface.append(j['code'])
            out = crop(img, face)
            size = min(512, out.shape[0])
            out = cv2.resize(out, (size, size), interpolation=cv2.INTER_AREA)
            cv2.imwrite(os.path.join(OUT, j['code'] + '.webp'), out, [cv2.IMWRITE_WEBP_QUALITY, 88])
            done.append(j['code'])
        except Exception as e:
            failed.append((j['code'], str(e)))
    print(f'done {len(done)} failed {len(failed)} 沒偵測到臉 {len(noface)}')
    if noface: print('  沒偵測到臉（要人工確認）:', ' '.join(noface))
    for c, e in failed[:10]: print('  x', c, e)

if __name__ == '__main__':
    main(sys.argv[1])
