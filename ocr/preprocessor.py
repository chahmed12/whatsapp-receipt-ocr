import cv2
import numpy as np

def preprocess(image_path):
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Impossible de lire l'image: {image_path}")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    denoised = cv2.medianBlur(thresh, 1)

    scale_percent = 200
    width = int(denoised.shape[1] * scale_percent / 100)
    height = int(denoised.shape[0] * scale_percent / 100)
    resized = cv2.resize(denoised, (width, height), interpolation=cv2.INTER_CUBIC)

    return resized

def save_debug(image, path):
    cv2.imwrite(path, image)
