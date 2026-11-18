"""Outline ridge map for the painted dragon frames: the dark maroon contour lines."""
import numpy as np
from PIL import Image, ImageFilter


def ridge_map(img_path, sigma=3.0):
    im = Image.open(img_path).convert('RGB')
    a = np.asarray(im, float)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    lum = 0.299 * R + 0.587 * G + 0.114 * B
    dark = np.clip((115 - lum) / 70, 0, 1)
    warm = np.clip((R - B + 5) / 35, 0, 1)          # navy background has B > R
    s = dark * warm
    sm = np.asarray(Image.fromarray((s * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(sigma)), float) / 255
    return sm


def dragon_mask(img_path):
    a = np.asarray(Image.open(img_path).convert('RGB'), float)
    return ((a[..., 0] - a[..., 2]) > 25).astype(float)
