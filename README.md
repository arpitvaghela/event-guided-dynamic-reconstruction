# Event-Guided Dynamic Reconstruction under Extreme Motion Blur

**[Project page](https://arpitvaghela.github.io/event-guided-dynamic-reconstruction/)** ·
**[Paper (PDF)](docs/assets/pdf/event-guided-dynamic-reconstruction.pdf)**

Reference implementation notes for the two components that make our method work:
**EDI-based SfM initialization** and a **continuous SE(3) B-spline camera pose module**.

---

## Contents

- [Part 1 — EDI-based SfM initialization](#part-1--edi-based-sfm-initialization)
- [Part 2 — Continuous SE(3) B-spline pose module](#part-2--continuous-se3-b-spline-pose-module)
- [Part 3 — What changes in rendering](#part-3--what-changes-in-rendering)

---

## Part 1 — EDI-based SfM initialization

### The formulation

A blurred frame is the temporal average of the sharp latent frames over the exposure. An event
camera gives the log-intensity change between any two instants in that window. Combining the two,
the latent frame at the start of the exposure is recoverable in closed form, and every other latent
frame follows from it:

```
log I(t0) = log I_blur - log( (1/N) * SUM_i exp( rho * E_i ) )

    I(ti) = I(t0) * exp( rho * E_i )
```

where `E_i` is the sum of events from `t0` up to bin `i`, `rho` the contrast threshold, and `N` the
number of sub-exposure bins.

### The code

```python
import torch

RGB2GRAY = torch.tensor([0.299, 0.587, 0.114]).view(1, 3, 1, 1)
EPS = 1e-5


def edi_sharp_frames(blur_image: torch.Tensor,
                     events: torch.Tensor) -> torch.Tensor:
    """Recover the sharp latent frames behind one blurred frame.

    Args:
        blur_image: [3, H, W] in [0, 1], the captured blurred frame.
        events:     [N, H, W] per-bin event sums over the exposure,
                    already scaled by the contrast threshold rho.

    Returns:
        [N, H, W] grayscale latent frames in [0, 1], one per bin.
    """
    gray = (blur_image * RGB2GRAY.to(blur_image)).sum(dim=-3)
    log_blur = torch.log(gray + EPS)

    # Running event sum from t0 to each bin boundary: [N+1, H, W].
    cumulative = torch.cumsum(events, dim=0)
    cumulative = torch.cat([torch.zeros_like(events[:1]), cumulative], dim=0)

    # The double integral, as a discrete mean over the exposure.
    integral = torch.log(torch.exp(cumulative).sum(dim=0) + EPS)
    n_bins = torch.log(torch.tensor(float(cumulative.shape[0])) + EPS)

    log_sharp_0 = log_blur - integral + n_bins
    sharp_0 = torch.exp(log_sharp_0)

    # Propagate t0 forward through the event stream.
    frames = sharp_0.unsqueeze(0) * torch.exp(cumulative)
    return frames.clamp(0.0, 1.0)
```

These recovered frames replace the blurred frames as the input to COLMAP. Because EDI produces
latent frames at the sub-exposure rate, the resulting trajectory is sampled **finer than the
blurred capture rate**, and that higher-frequency initialization is what the spline in Part 2 gets
fitted to.

---

## Part 2 — Continuous SE(3) B-spline pose module

### What changes

| | Per-frame baseline | Ours |
| --- | --- | --- |
| Learnable tensor | `randn_se3((num_cameras, 4))` | `randn_se3((num_segments + 1,))` |
| Parameter count | 4 knots × every frame | fixed by motion complexity, not frame count |
| Indexed by | camera index | **timestamp** |
| Knot vector | none — knots are frame-local | clamped uniform, spans the sequence |
| Sharing | none between frames | each control point supports a window of time |
| Output | a **delta**, composed as `c2w @ ΔP` | the **absolute pose** `P(t)` |

The per-frame baseline follows [BAD-Gaussians](https://github.com/WU-CVGL/BAD-Gaussians).

### Setting up the spline

A clamped uniform knot vector: the first and last `k` knots are repeated so the curve passes
through its endpoints, with the interior spaced evenly over `[0, 1]`.

```python
import torch
import pypose as pp
from torch import nn


class CameraPoseModule(nn.Module):
    """One continuous cubic B-spline in SE(3) over the whole sequence."""

    def __init__(self, num_segments: int, num_virtual_views: int, device, mode="cubic"):
        super().__init__()
        self.num_segments = num_segments
        self.num_virtual_views = num_virtual_views
        self.order = {"linear": 2, "cubic": 4}[mode]
        self.mode = mode

        self.knot_vector = self._clamped_knot_vector(num_segments, self.order)

        # One global set of control points. Note sigma=1e-2: these are the
        # trajectory itself, not small corrections to an existing one.
        self.pose_adjustment = pp.Parameter(
            pp.randn_se3(num_segments + 1, sigma=1e-2, device=device)
        )

    @staticmethod
    def _clamped_knot_vector(n_segments: int, order: int) -> torch.Tensor:
        n_control_points = n_segments + 1
        knot_count = n_control_points + order

        start = torch.zeros(order)
        end = torch.ones(order)

        middle_count = knot_count - 2 * order
        if middle_count > 0:
            step = 1.0 / (middle_count + 1)
            middle = torch.arange(1, middle_count + 1, dtype=torch.float32) * step
        else:
            middle = torch.tensor([], dtype=torch.float32)

        return torch.cat([start, middle, end])
```

`num_segments` tracks motion complexity rather than sequence length. We start at 200 and step by 40
until the Stage-1 fit drops below a mean pose error of 5 × 10⁻³.

### Timestamp → spline parameter

```python
    def _span_index(self, t: torch.Tensor) -> int:
        """Index i with knot_vector[i] <= t < knot_vector[i+1]."""
        kv = self.knot_vector
        if t == kv[-1]:                       # right endpoint is closed
            return len(kv) - self.order - 2
        spans = torch.nonzero((kv[:-1] <= t) & (t < kv[1:]), as_tuple=False)
        if len(spans) == 0:
            raise ValueError(f"t={t.item()} lies outside the knot vector")
        return spans[-1].item()

    def local_parameter(self, times: torch.Tensor) -> torch.Tensor:
        """Normalize each timestamp to u' in [0, 1] within its own span."""
        kv, k = self.knot_vector, self.order
        u = torch.zeros_like(times.flatten())
        for idx, t in enumerate(times.flatten()):
            i = self._span_index(t)
            t_i, t_ik = kv[i], kv[i + k - 1]
            u[idx] = 0.0 if t_ik == t_i else (t - t_i) / (t_ik - t_i)
        return u

    def active_control_points(self, times: torch.Tensor) -> torch.Tensor:
        """The k control points that influence each timestamp — local support."""
        kv, k = self.knot_vector, self.order
        n = len(kv) - k - 1
        rows = []
        for t in times.flatten():
            i = self._span_index(t)
            start = max(0, i - k + 1)
            rows.append(torch.arange(start, min(start + k, n + 1)))
        return torch.stack(rows)
```

`active_control_points` is where temporal coherence comes from. A cubic spline blends 4 control
points at any instant, and consecutive instants share 3 of them, so a gradient that corrects one
pose necessarily moves its neighbours. Smoothness is a property of the parameterization — there is
no smoothness penalty anywhere in the loss.

### Sampling a pose

```python
    def forward(self, times: torch.FloatTensor) -> pp.LieTensor:
        u = self.local_parameter(times).unsqueeze(1).to(self.pose_adjustment.device)
        rows = self.active_control_points(times)

        # [B, k, 7] -- the local support of each timestamp, lifted to SE(3).
        control_knots = self.pose_adjustment[rows].Exp()

        if self.mode == "cubic":
            poses = cubic_bspline_interpolation(control_knots, u)
        else:
            poses = linear_interpolation(control_knots, u)
        return poses.lview(*times.shape, -1)
```

### Cubic B-spline interpolation on SE(3)

The interpolation itself is unchanged from BAD-Gaussians — what differs is the control knots fed
into it. BAD-Gaussians passes the four knots belonging to a single frame; we pass four slices of
the one global control point tensor, picked out by timestamp with `active_control_points` above.

```python
def cubic_bspline_interpolation(ctrl_knots, u):
    """Cubic B-spline through batches of four SE(3) control knots.

    Args:
        ctrl_knots: [..., 4, 7] SE(3) control points.
        u:          [..., interpolations] positions in [0, 1].
    Returns:
        [..., interpolations, 7] interpolated SE(3) poses.
    """
    batch_size = ctrl_knots.shape[:-2]
    interpolations = u.shape[-1]
    if u.dim() == 1:
        u = u.tile((*batch_size, 1))

    uu, uuu = u * u, u * u * u
    oos = 1.0 / 6.0

    # Standard uniform cubic B-spline basis, applied directly to translation.
    coeffs_t = torch.stack([
        oos - 0.5 * u + 0.5 * uu - oos * uuu,
        4.0 * oos - uu + 0.5 * uuu,
        oos + 0.5 * u + 0.5 * uu - 0.5 * uuu,
        oos * uuu,
    ], dim=-2)
    t_t = torch.sum(pp.bvv(coeffs_t, ctrl_knots.translation()), dim=-3)

    # Cumulative basis -- three weights for the three relative rotations.
    coeffs_r = torch.stack([
        5.0 * oos + 0.5 * u - 0.5 * uu + oos * uuu,
        oos + 0.5 * u + 0.5 * uu - 2 * oos * uuu,
        oos * uuu,
    ], dim=-2)

    q_adjacent = ctrl_knots[..., :-1, :].rotation().Inv() \
               @ ctrl_knots[..., 1:, :].rotation()
    q_ts = pp.Exp(pp.so3(pp.bvv(coeffs_r, q_adjacent.Log())))

    q0 = ctrl_knots[..., 0, :].rotation()
    q_ts = torch.cat([
        q0.unsqueeze(-2).tile((interpolations, 1)).unsqueeze(-3),
        q_ts,
    ], dim=-3)
    q_t = pp.cumprod(q_ts, dim=-3, left=False)[..., -1, :, :]

    return pp.SE3(torch.cat([t_t, q_t], dim=-1))
```

### Stage 1 — fitting the spline to the EDI poses

Before any Gaussian is touched, the spline is fitted to the COLMAP-on-EDI trajectory. Only the
control points move, so this is cheap next to the rest of training.

```python
def geodesic_pose_loss(pred: pp.LieTensor, gt: pp.LieTensor) -> torch.Tensor:
    """Mean geodesic distance between two batches of SE(3) poses."""
    residual = pred @ gt.Inv()
    return residual.Log().norm(dim=-1).mean()


model = CameraPoseModule(num_segments=200, num_virtual_views=18, device="cuda")
optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)

for step in range(10_000):
    pred = model(times)                    # times from the EDI frame stamps
    loss = geodesic_pose_loss(pred, gt_poses)
    optimizer.zero_grad()
    loss.backward()
    optimizer.step()
```

---

## Part 3 — What changes in rendering

A standard 4DGS `render()` takes **one camera** and rasterizes **once**:

```python
def render(cam, pc, pipe, bg_color, stage="fine"):
    means3D = pc.get_xyz
    time = torch.tensor(cam.time).to(means3D.device).repeat(means3D.shape[0], 1)

    means3D_final, scales_final, rotations_final, opacity_final, shs_final = \
        pc._deformation(means3D, pc._scaling, pc._rotation, pc._opacity, pc.get_features, time)

    renders, alphas, info = rasterization(
        means=means3D_final, quats=rotations_final, scales=scales_final,
        opacities=opacity_final.squeeze(-1), colors=shs_final,
        viewmats=cam.world_view_transform.transpose(0, 1)[None],
        Ks=K[None], width=int(cam.image_width), height=int(cam.image_height),
        sh_degree=pc.active_sh_degree, render_mode="RGB+ED",
    )
    return {"render": renders[..., 0:3][0].permute(2, 0, 1)}   # [C, H, W]
```

`render_blur()` keeps that body unchanged and wraps it in a loop over virtual cameras sampled from
the spline across one exposure. Two things differ.

### 1. Virtual views land on real sub-exposure timestamps

The camera is no longer an input — it is produced by the pose module from timestamps. Those are the
timestamps the latent frames actually carry, resampled up to `num_virtual_views` where there are
fewer latent frames than virtual views:

```python
times = np.array([s.time for s in viewpoint_sample.sharp_cams])

n_virt = pc.camera_optimizer.num_virtual_views
if n_virt > len(times):
    times = np.interp(
        np.linspace(0, len(times) - 1, n_virt),
        np.arange(len(times)),
        times,
    )

virtual_cameras = pc.camera_optimizer.apply_to_camera(
    viewpoint_sample.dummy_cam, viewpoint_sample.ts, viewpoint_sample.te,
    "uniform", times=torch.tensor(times, dtype=torch.float32),
)
```

Because the spline is parameterized in absolute time, feeding it a frame-local
`torch.linspace(0, 1, n)` would sample the wrong part of the curve.

### 2. Each virtual view carries its own time into the deformation field

```python
virtual_views = []

for cam in virtual_cameras:
    # Identical to render(), but cam.time differs on every iteration.
    time = torch.tensor(cam.time).to(means3D.device).repeat(means3D.shape[0], 1)

    means3D_final, scales_final, rotations_final, opacity_final, shs_final = \
        pc._deformation(means3D, scales, rotations, opacity, shs, time)

    renders, alphas, info = rasterization(
        means=means3D_final, quats=rotations_final, scales=scales_final,
        opacities=opacity_final.squeeze(-1), colors=shs_final,
        viewmats=cam.world_view_transform.transpose(0, 1)[None],
        Ks=K[None], width=int(cam.image_width), height=int(cam.image_height),
        sh_degree=pc.active_sh_degree, render_mode="RGB+ED",
    )
    virtual_views.append(renders[..., 0:3].permute(0, 3, 1, 2))

# Every virtual view is returned, not a single image.
render_pkg = {"render": torch.cat(virtual_views, dim=0)}   # [n_virtual, C, H, W]

# Downstream, in the training loop:
# pred_blur_image = render_pkg["render"].mean(dim=0)
# loss  = ...   # against the captured blurred frame
# loss += ...   # against the EDI-recovered latent frames
```

---

## Acknowledgements

[4DGaussians](https://github.com/hustvl/4DGaussians) ·
[BAD-Gaussians](https://github.com/WU-CVGL/BAD-Gaussians) ·
[PyPose](https://github.com/pypose/pypose) ·
[Dycheck](https://github.com/KAIR-BAIR/dycheck) ·
[ESIM](https://github.com/uzh-rpg/rpg_esim) ·
[RIFE](https://github.com/hzwer/ECCV2022-RIFE)
