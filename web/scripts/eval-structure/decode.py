"""Decode an audio file to interleaved float32 stereo (needs `pip install soundfile`)."""
import sys

import numpy as np
import soundfile as sf

data, fs = sf.read(sys.argv[1], dtype="float32", always_2d=True)
if data.shape[1] == 1:
    data = np.repeat(data, 2, axis=1)
np.ascontiguousarray(data[:, :2]).tofile(sys.argv[2])
print(fs, data.shape[0])
