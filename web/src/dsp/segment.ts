/**
 * Unsupervised section labelling by spectral clustering of a recurrence
 * graph ("Laplacian segmentation", McFee & Ellis, ISMIR 2014):
 *  - mutual k-NN recurrence on time-delay-embedded chroma + timbre,
 *    median-filtered along diagonals to keep repeated passages
 *  - local path links weighted by timbre continuity
 *  - the first eigenvectors of the normalised Laplacian, clustered with
 *    k-means, give one label per unit (same label = same material)
 */
import { median } from "./util";

/** Eigen-decomposition of a symmetric matrix (Householder + implicit QL, after JAMA/EISPACK). Ascending eigenvalues; vectors are columns of V. */
export function eigSym(A: Float64Array[]): { values: Float64Array; V: Float64Array[] } {
  const n = A.length;
  const V = A.map((r) => Float64Array.from(r));
  const d = new Float64Array(n);
  const e = new Float64Array(n);
  for (let j = 0; j < n; j++) d[j] = V[n - 1][j];
  // tred2: Householder reduction to tridiagonal form
  for (let i = n - 1; i > 0; i--) {
    let scale = 0, h = 0;
    for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
    if (scale === 0) {
      e[i] = d[i - 1];
      for (let j = 0; j < i; j++) {
        d[j] = V[i - 1][j];
        V[i][j] = 0;
        V[j][i] = 0;
      }
    } else {
      for (let k = 0; k < i; k++) {
        d[k] /= scale;
        h += d[k] * d[k];
      }
      let f = d[i - 1];
      let g = Math.sqrt(h);
      if (f > 0) g = -g;
      e[i] = scale * g;
      h -= f * g;
      d[i - 1] = f - g;
      for (let j = 0; j < i; j++) e[j] = 0;
      for (let j = 0; j < i; j++) {
        f = d[j];
        V[j][i] = f;
        g = e[j] + V[j][j] * f;
        for (let k = j + 1; k <= i - 1; k++) {
          g += V[k][j] * d[k];
          e[k] += V[k][j] * f;
        }
        e[j] = g;
      }
      f = 0;
      for (let j = 0; j < i; j++) {
        e[j] /= h;
        f += e[j] * d[j];
      }
      const hh = f / (h + h);
      for (let j = 0; j < i; j++) e[j] -= hh * d[j];
      for (let j = 0; j < i; j++) {
        f = d[j];
        g = e[j];
        for (let k = j; k <= i - 1; k++) V[k][j] -= f * e[k] + g * d[k];
        d[j] = V[i - 1][j];
        V[i][j] = 0;
      }
    }
    d[i] = h;
  }
  for (let i = 0; i < n - 1; i++) {
    V[n - 1][i] = V[i][i];
    V[i][i] = 1;
    const h = d[i + 1];
    if (h !== 0) {
      for (let k = 0; k <= i; k++) d[k] = V[k][i + 1] / h;
      for (let j = 0; j <= i; j++) {
        let g = 0;
        for (let k = 0; k <= i; k++) g += V[k][i + 1] * V[k][j];
        for (let k = 0; k <= i; k++) V[k][j] -= g * d[k];
      }
    }
    for (let k = 0; k <= i; k++) V[k][i + 1] = 0;
  }
  for (let j = 0; j < n; j++) {
    d[j] = V[n - 1][j];
    V[n - 1][j] = 0;
  }
  V[n - 1][n - 1] = 1;
  e[0] = 0;
  // tql2: symmetric tridiagonal QL
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  let f = 0, tst1 = 0;
  const eps = 2 ** -52;
  for (let l = 0; l < n; l++) {
    tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
    let m = l;
    while (m < n && Math.abs(e[m]) > eps * tst1) m++;
    if (m > l) {
      let iter = 0;
      do {
        if (++iter > 60) break;
        let g = d[l];
        let p = (d[l + 1] - g) / (2 * e[l]);
        let r = Math.hypot(p, 1);
        if (p < 0) r = -r;
        d[l] = e[l] / (p + r);
        d[l + 1] = e[l] * (p + r);
        const dl1 = d[l + 1];
        let h = g - d[l];
        for (let i = l + 2; i < n; i++) d[i] -= h;
        f += h;
        p = d[m];
        let c = 1, c2 = 1, c3 = 1, s = 0, s2 = 0;
        const el1 = e[l + 1];
        for (let i = m - 1; i >= l; i--) {
          c3 = c2;
          c2 = c;
          s2 = s;
          g = c * e[i];
          h = c * p;
          r = Math.hypot(p, e[i]);
          e[i + 1] = s * r;
          s = e[i] / r;
          c = p / r;
          p = c * d[i] - s * g;
          d[i + 1] = h + s * (c * g + s * d[i]);
          for (let k = 0; k < n; k++) {
            const row = V[k];
            h = row[i + 1];
            row[i + 1] = s * row[i] + c * h;
            row[i] = c * row[i] - s * h;
          }
        }
        p = (-s * s2 * c3 * el1 * e[l]) / dl1;
        e[l] = s * p;
        d[l] = c * p;
      } while (Math.abs(e[l]) > eps * tst1);
    }
    d[l] += f;
    e[l] = 0;
  }
  // sort ascending
  for (let i = 0; i < n - 1; i++) {
    let k = i, p = d[i];
    for (let j = i + 1; j < n; j++) if (d[j] < p) {
      k = j;
      p = d[j];
    }
    if (k !== i) {
      d[k] = d[i];
      d[i] = p;
      for (let j = 0; j < n; j++) {
        const t = V[j][i];
        V[j][i] = V[j][k];
        V[j][k] = t;
      }
    }
  }
  return { values: d, V };
}

/** Deterministic k-means (k-means++ seeding, several restarts). */
export function kmeans(X: Float64Array[], k: number, restarts = 8, seed = 7): Int32Array {
  const n = X.length, dim = X[0]?.length ?? 0;
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const dist2 = (p: Float64Array, q: Float64Array) => {
    let s = 0;
    for (let i = 0; i < dim; i++) s += (p[i] - q[i]) ** 2;
    return s;
  };
  let best = new Int32Array(n), bestInertia = Infinity;
  for (let r = 0; r < restarts; r++) {
    const C: Float64Array[] = [Float64Array.from(X[Math.floor(rnd() * n)])];
    const dmin = X.map((x) => dist2(x, C[0]));
    while (C.length < k) {
      const tot = dmin.reduce((s, v) => s + v, 0);
      let u = rnd() * tot, pick = n - 1;
      for (let i = 0; i < n; i++) if ((u -= dmin[i]) <= 0) {
        pick = i;
        break;
      }
      C.push(Float64Array.from(X[pick]));
      for (let i = 0; i < n; i++) dmin[i] = Math.min(dmin[i], dist2(X[i], C[C.length - 1]));
    }
    const lab = new Int32Array(n);
    let inertia = 0;
    for (let it = 0; it < 60; it++) {
      let moved = 0;
      inertia = 0;
      for (let i = 0; i < n; i++) {
        let bj = 0, bd = Infinity;
        for (let j = 0; j < k; j++) {
          const dd = dist2(X[i], C[j]);
          if (dd < bd) {
            bd = dd;
            bj = j;
          }
        }
        if (lab[i] !== bj || it === 0) moved++;
        lab[i] = bj;
        inertia += bd;
      }
      const cnt = new Int32Array(k);
      for (const c of C) c.fill(0);
      for (let i = 0; i < n; i++) {
        cnt[lab[i]]++;
        for (let q = 0; q < dim; q++) C[lab[i]][q] += X[i][q];
      }
      for (let j = 0; j < k; j++) {
        if (cnt[j]) for (let q = 0; q < dim; q++) C[j][q] /= cnt[j];
        else C[j] = Float64Array.from(X[Math.floor(rnd() * n)]);
      }
      if (!moved) break;
    }
    if (inertia < bestInertia) {
      bestInertia = inertia;
      best = lab;
    }
  }
  return best;
}

function medianFilter1d(xs: ArrayLike<number>, size: number): Float64Array {
  const n = xs.length, h = Math.floor(size / 2);
  const out = new Float64Array(n);
  const win: number[] = [];
  for (let i = 0; i < n; i++) {
    win.length = 0;
    for (let k = Math.max(0, i - h); k <= Math.min(n - 1, i + h); k++) win.push(xs[k]);
    win.sort((p, q) => p - q);
    out[i] = win[win.length >> 1];
  }
  return out;
}

export interface SpectralEmbedding {
  /** Rows = units, columns = the first eigenvectors (smoothed), ascending eigenvalue. */
  evecs: Float64Array[];
  values: Float64Array;
}

/**
 * Build the recurrence + path graph and return its Laplacian embedding.
 * `rep` drives repetition (chroma/timbre per unit), `path` local continuity (MFCC-like).
 */
export function laplacianEmbedding(rep: Float64Array[], path: Float64Array[], maxVecs = 12, steps = 4, smoothing = 9): SpectralEmbedding {
  const n = rep.length;
  const dim = rep[0].length;
  // time-delay embedding, centred on the unit so boundaries do not lag
  const half = Math.floor(steps / 2);
  const Z = rep.map((_, i) => {
    const z = new Float64Array(dim * steps);
    for (let s = 0; s < steps; s++) {
      const src = rep[Math.min(n - 1, Math.max(0, i - half + s))];
      z.set(src, s * dim);
    }
    return z;
  });
  const D: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      let s = 0;
      const zi = Z[i], zj = Z[j];
      for (let q = 0; q < zi.length; q++) s += (zi[q] - zj[q]) ** 2;
      D[i][j] = D[j][i] = Math.sqrt(s);
    }
  // mutual k-NN, excluding the immediate neighbourhood
  const width = 3;
  const k = Math.min(n - 2 * width - 1, 2 * Math.ceil(Math.sqrt(n - 2 * width + 1)));
  const kth = new Float64Array(n);
  const nn: Set<number>[] = [];
  for (let i = 0; i < n; i++) {
    const cand: number[] = [];
    for (let j = 0; j < n; j++) if (Math.abs(i - j) >= width) cand.push(j);
    cand.sort((p, q) => D[i][p] - D[i][q]);
    const top = cand.slice(0, Math.max(1, k));
    nn.push(new Set(top));
    kth[i] = D[i][top[top.length - 1]] ?? 1;
  }
  const bw = median(kth) || 1;
  const R: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++)
    for (const j of nn[i]) if (j > i && nn[j].has(i)) R[i][j] = R[j][i] = Math.exp(-D[i][j] / bw);
  // keep diagonal stripes: median filter along each diagonal (time-lag filter)
  const Rf: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
  for (let lag = 1; lag < n; lag++) {
    const diag = new Float64Array(n - lag);
    for (let i = 0; i + lag < n; i++) diag[i] = R[i][i + lag];
    const f = medianFilter1d(diag, 7);
    for (let i = 0; i + lag < n; i++) Rf[i][i + lag] = Rf[i + lag][i] = f[i];
  }
  // local path links
  const pd = new Float64Array(Math.max(0, n - 1));
  for (let i = 0; i + 1 < n; i++) {
    let s = 0;
    for (let q = 0; q < path[i].length; q++) s += (path[i + 1][q] - path[i][q]) ** 2;
    pd[i] = s;
  }
  const sigma = median(pd) || 1;
  const ps = Array.from(pd, (v) => Math.exp(-v / sigma));
  const degRec = Rf.map((r) => r.reduce((s, v) => s + v, 0));
  const degPath = new Float64Array(n);
  for (let i = 0; i + 1 < n; i++) {
    degPath[i] += ps[i];
    degPath[i + 1] += ps[i];
  }
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += degPath[i] * (degPath[i] + degRec[i]);
    den += (degPath[i] + degRec[i]) ** 2;
  }
  const mu = den > 0 ? num / den : 0.5;
  // A = mu Rf + (1 - mu) Rpath; work with S = D^-1/2 A D^-1/2 (eig(L) = 1 - eig(S))
  const A = Rf.map((r) => r.map((v) => mu * v));
  for (let i = 0; i + 1 < n; i++) {
    A[i][i + 1] += (1 - mu) * ps[i];
    A[i + 1][i] += (1 - mu) * ps[i];
  }
  const deg = A.map((r) => r.reduce((s, v) => s + v, 0));
  const inv = deg.map((v) => (v > 0 ? 1 / Math.sqrt(v) : 0));
  const Lm = A.map((r, i) => r.map((v, j) => (i === j ? 1 : 0) - v * inv[i] * inv[j]));
  const { values, V } = eigSym(Lm);
  const m = Math.min(maxVecs, n);
  const cols: Float64Array[] = [];
  for (let c = 0; c < m; c++) cols.push(medianFilter1d(V.map((row) => row[c]), smoothing | 1));
  const evecs = Array.from({ length: n }, (_, i) => Float64Array.from(cols, (col) => col[i]));
  return { evecs, values: values.slice(0, m) };
}

/** Cluster the embedding into k groups (rows normalised as in McFee & Ellis). */
export function clusterEmbedding(emb: SpectralEmbedding, k: number): Int32Array {
  const X = emb.evecs.map((row) => {
    const x = row.slice(0, k);
    let s = 0;
    for (const v of x) s += v * v;
    const nrm = Math.sqrt(s) || 1;
    return x.map((v) => v / nrm) as Float64Array;
  });
  return kmeans(X, k);
}
