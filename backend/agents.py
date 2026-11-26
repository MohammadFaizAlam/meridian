"""Pure-Python RL agents with action masking, Dueling Double DQN + PER, PPO, A2C, and Q-Learning."""

from __future__ import annotations

import math
import random
from typing import Any, Dict, List, Optional, Tuple

from environment import valid_mask_from_state


def _tanh(x: float) -> float:
    if x > 16.0:
        return 1.0
    if x < -16.0:
        return -1.0
    return math.tanh(x)


def _masked_softmax(logits: List[float], mask: List[bool]) -> List[float]:
    valid_vals = [logits[i] for i in range(len(logits)) if mask[i]]
    if not valid_vals:
        return [1.0 / len(logits)] * len(logits)
    m = max(valid_vals)
    exps = [
        math.exp(max(-28.0, min(28.0, logits[i] - m))) if mask[i] else 0.0
        for i in range(len(logits))
    ]
    s = sum(exps)
    if s <= 1e-12:
        n_valid = sum(1 for ok in mask if ok)
        return [(1.0 / n_valid) if ok else 0.0 for ok in mask]
    return [e / s for e in exps]


def _sample_categorical(probs: List[float], rng: random.Random) -> int:
    r = rng.random()
    acc = 0.0
    for i, p in enumerate(probs):
        acc += p
        if r <= acc and p > 0.0:
            return i
    return max(range(len(probs)), key=lambda i: probs[i])


def _masked_argmax(values: List[float], mask: List[bool]) -> int:
    best_i = 0
    best_v = -1e18
    for i, v in enumerate(values):
        if mask[i] and v > best_v:
            best_v = v
            best_i = i
    return best_i


class DeepMLP:
    """Two-hidden-layer MLP with AdamW weight decay and global norm clipping."""

    def __init__(self, in_dim: int, h1: int, h2: int, out_dim: int, rng: random.Random):
        self.in_dim = in_dim
        self.h1 = h1
        self.h2 = h2
        self.out_dim = out_dim

        s1 = math.sqrt(2.0 / (in_dim + h1))
        s2 = math.sqrt(2.0 / (h1 + h2))
        s3 = math.sqrt(2.0 / (h2 + out_dim)) * 0.6

        self.w1 = [[rng.gauss(0.0, s1) for _ in range(in_dim)] for _ in range(h1)]
        self.b1 = [0.0] * h1
        self.w2 = [[rng.gauss(0.0, s2) for _ in range(h1)] for _ in range(h2)]
        self.b2 = [0.0] * h2
        self.w3 = [[rng.gauss(0.0, s3) for _ in range(h2)] for _ in range(out_dim)]
        self.b3 = [0.0] * out_dim

        self.t = 0
        self.m: Dict[str, Any] = self._zeros()
        self.v: Dict[str, Any] = self._zeros()

    def _zeros(self) -> Dict[str, Any]:
        return {
            "w1": [[0.0] * self.in_dim for _ in range(self.h1)],
            "b1": [0.0] * self.h1,
            "w2": [[0.0] * self.h1 for _ in range(self.h2)],
            "b2": [0.0] * self.h2,
            "w3": [[0.0] * self.h2 for _ in range(self.out_dim)],
            "b3": [0.0] * self.out_dim,
        }

    def zero_grads(self) -> Dict[str, Any]:
        return self._zeros()

    def forward_with_cache(self, x: List[float]) -> Tuple[List[float], List[float], List[float]]:
        a1 = []
        for j in range(self.h1):
            row = self.w1[j]
            s = self.b1[j]
            for i in range(self.in_dim):
                s += row[i] * x[i]
            a1.append(_tanh(s))

        a2 = []
        for j in range(self.h2):
            row = self.w2[j]
            s = self.b2[j]
            for i in range(self.h1):
                s += row[i] * a1[i]
            a2.append(_tanh(s))

        out = []
        for k in range(self.out_dim):
            row = self.w3[k]
            s = self.b3[k]
            for j in range(self.h2):
                s += row[j] * a2[j]
            out.append(s)
        return out, a1, a2

    def forward(self, x: List[float]) -> List[float]:
        out, _, _ = self.forward_with_cache(x)
        return out

    def backward_accumulate(
        self,
        x: List[float],
        a1: List[float],
        a2: List[float],
        d_out: List[float],
        grads: Dict[str, Any],
    ) -> None:
        d_a2 = [0.0] * self.h2
        gw3, gb3 = grads["w3"], grads["b3"]
        for k in range(self.out_dim):
            dk = d_out[k]
            if dk == 0.0:
                continue
            gb3[k] += dk
            w3k, gw3k = self.w3[k], gw3[k]
            for j in range(self.h2):
                gw3k[j] += dk * a2[j]
                d_a2[j] += dk * w3k[j]

        d_a1 = [0.0] * self.h1
        gw2, gb2 = grads["w2"], grads["b2"]
        for j in range(self.h2):
            dj = d_a2[j] * (1.0 - a2[j] * a2[j])
            if dj == 0.0:
                continue
            gb2[j] += dj
            w2j, gw2j = self.w2[j], gw2[j]
            for i in range(self.h1):
                gw2j[i] += dj * a1[i]
                d_a1[i] += dj * w2j[i]

        gw1, gb1 = grads["w1"], grads["b1"]
        for j in range(self.h1):
            dj = d_a1[j] * (1.0 - a1[j] * a1[j])
            if dj == 0.0:
                continue
            gb1[j] += dj
            gw1j = gw1[j]
            for i in range(self.in_dim):
                gw1j[i] += dj * x[i]

    def adamw_step(
        self,
        grads: Dict[str, Any],
        lr: float,
        scale: float = 1.0,
        weight_decay: float = 1e-4,
        max_norm: float = 1.5,
    ) -> None:
        self.t += 1
        beta1, beta2, eps = 0.9, 0.999, 1e-8
        bc1 = 1.0 - beta1 ** self.t
        bc2 = 1.0 - beta2 ** self.t

        # Compute global gradient norm for clipping
        sq_sum = 0.0
        for key in ("b1", "b2", "b3"):
            for g in grads[key]:
                gs = g * scale
                sq_sum += gs * gs
        for key in ("w1", "w2", "w3"):
            for row in grads[key]:
                for g in row:
                    gs = g * scale
                    sq_sum += gs * gs
        gnorm = math.sqrt(sq_sum)
        eff_scale = scale * (max_norm / gnorm) if gnorm > max_norm else scale

        def _upd(param: float, g: float, m: float, v: float, decay: float) -> Tuple[float, float, float]:
            g = g * eff_scale
            m = beta1 * m + (1.0 - beta1) * g
            v = beta2 * v + (1.0 - beta2) * g * g
            step = (m / bc1) / (math.sqrt(v / bc2) + eps)
            return param * (1.0 - lr * decay) - lr * step, m, v

        for key in ("b1", "b2", "b3"):
            params = getattr(self, key)
            g_arr, m_arr, v_arr = grads[key], self.m[key], self.v[key]
            for i in range(len(params)):
                params[i], m_arr[i], v_arr[i] = _upd(params[i], g_arr[i], m_arr[i], v_arr[i], 0.0)

        for key in ("w1", "w2", "w3"):
            mat = getattr(self, key)
            g_mat, m_mat, v_mat = grads[key], self.m[key], self.v[key]
            for r in range(len(mat)):
                row, gr, mr, vr = mat[r], g_mat[r], m_mat[r], v_mat[r]
                for c in range(len(row)):
                    row[c], mr[c], vr[c] = _upd(row[c], gr[c], mr[c], vr[c], weight_decay)

    def copy_from(self, other: "DeepMLP", tau: float = 1.0) -> None:
        inv = 1.0 - tau
        for key in ("b1", "b2", "b3"):
            dst, src = getattr(self, key), getattr(other, key)
            for i in range(len(dst)):
                dst[i] = tau * src[i] + inv * dst[i]
        for key in ("w1", "w2", "w3"):
            dst, src = getattr(self, key), getattr(other, key)
            for r in range(len(dst)):
                dr, sr = dst[r], src[r]
                for c in range(len(dr)):
                    dr[c] = tau * sr[c] + inv * dr[c]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "in_dim": self.in_dim,
            "h1": self.h1,
            "h2": self.h2,
            "out_dim": self.out_dim,
            "w1": self.w1,
            "b1": self.b1,
            "w2": self.w2,
            "b2": self.b2,
            "w3": self.w3,
            "b3": self.b3,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DeepMLP":
        net = cls(data["in_dim"], data["h1"], data["h2"], data["out_dim"], random.Random(0))
        net.w1 = [list(r) for r in data["w1"]]
        net.b1 = list(data["b1"])
        net.w2 = [list(r) for r in data["w2"]]
        net.b2 = list(data["b2"])
        net.w3 = [list(r) for r in data["w3"]]
        net.b3 = list(data["b3"])
        return net


class BaseAgent:
    name: str = "base"

    def select_action(self, state: List[float], greedy: bool = False, valid_mask: Optional[List[bool]] = None) -> int:
        raise NotImplementedError

    def observe(self, state: List[float], action: int, reward: float, next_state: List[float], done: bool) -> None:
        pass

    def end_episode(self, progress: float = 0.0) -> Dict[str, float]:
        return {}

    def predict_signal(self, state: List[float], valid_mask: Optional[List[bool]] = None) -> Dict[str, Any]:
        raise NotImplementedError

    def serialize(self) -> Dict[str, Any]:
        raise NotImplementedError


class DQNAgent(BaseAgent):
    """Dueling Double DQN with Prioritized Experience Replay and action masking."""

    name = "DQN"

    def __init__(
        self,
        state_dim: int,
        action_dim: int = 3,
        lr: float = 0.002,
        gamma: float = 0.97,
        epsilon_start: float = 0.85,
        epsilon_min: float = 0.04,
        epsilon_decay: float = 0.92,
        batch_size: int = 24,
        seed: int = 42,
    ):
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.base_lr = lr
        self.lr = lr
        self.gamma = gamma
        self.epsilon = epsilon_start
        self.epsilon_min = epsilon_min
        self.epsilon_decay = epsilon_decay
        self.batch_size = batch_size
        self.rng = random.Random(seed)

        # Output layout: [V(s), A(s,0), A(s,1), A(s,2)]
        self.q_net = DeepMLP(state_dim, 28, 16, action_dim + 1, self.rng)
        self.target_net = DeepMLP(state_dim, 28, 16, action_dim + 1, self.rng)
        self.target_net.copy_from(self.q_net, tau=1.0)

        self.capacity = 3000
        self.replay: List[Tuple[List[float], int, float, List[float], bool]] = []
        self.priorities: List[float] = []
        self.write_idx = 0
        self.max_prio = 1.0
        self.per_alpha = 0.55
        self.per_beta = 0.45
        self.steps = 0
        self.last_loss = 0.0

    def _dueling_q(self, raw_out: List[float]) -> List[float]:
        v = raw_out[0]
        adv = raw_out[1:]
        mean_a = sum(adv) / len(adv)
        return [v + (a - mean_a) for a in adv]

    def _q_values(self, net: DeepMLP, state: List[float]) -> List[float]:
        return self._dueling_q(net.forward(state))

    def select_action(
        self,
        state: List[float],
        greedy: bool = False,
        valid_mask: Optional[List[bool]] = None,
    ) -> int:
        mask = valid_mask or valid_mask_from_state(state)
        if not greedy and self.rng.random() < self.epsilon:
            legal = [i for i, ok in enumerate(mask) if ok]
            return self.rng.choice(legal)
        q_vals = self._q_values(self.q_net, state)
        return _masked_argmax(q_vals, mask)

    def predict_signal(self, state: List[float], valid_mask: Optional[List[bool]] = None) -> Dict[str, Any]:
        mask = valid_mask or [True, True, True]
        q_vals = self._q_values(self.q_net, state)
        # Scale Q-spread into readable softmax probabilities
        spread = max(0.15, max(q_vals) - min(q_vals))
        scaled = [q / (spread * 0.65) for q in q_vals]
        probs = _masked_softmax(scaled, mask)
        best = _masked_argmax(q_vals, mask)
        return {
            "action": best,
            "holdProb": round(probs[0], 4),
            "buyProb": round(probs[1], 4),
            "sellProb": round(probs[2], 4),
            "qValues": [round(q, 4) for q in q_vals],
        }

    def observe(self, state: List[float], action: int, reward: float, next_state: List[float], done: bool) -> None:
        item = (state, action, reward, next_state, done)
        if len(self.replay) < self.capacity:
            self.replay.append(item)
            self.priorities.append(self.max_prio)
        else:
            self.replay[self.write_idx] = item
            self.priorities[self.write_idx] = self.max_prio
        self.write_idx = (self.write_idx + 1) % self.capacity

        self.steps += 1
        if len(self.replay) >= self.batch_size and self.steps % 5 == 0:
            self._train_batch()
        if self.steps % 35 == 0:
            self.target_net.copy_from(self.q_net, tau=0.22)

    def _sample_prioritized(self) -> Tuple[List[int], List[float]]:
        n = len(self.replay)
        scaled = [p ** self.per_alpha for p in self.priorities]
        total = sum(scaled)
        indices: List[int] = []
        weights: List[float] = []
        segment = total / self.batch_size
        inv_n = 1.0 / n

        # Stratified sampling keeps replay low-variance and fast
        cursor = 0
        cum = scaled[0]
        for b in range(self.batch_size):
            target = (b + self.rng.random()) * segment
            while cum < target and cursor < n - 1:
                cursor += 1
                cum += scaled[cursor]
            indices.append(cursor)
            prob = max(scaled[cursor] / total, 1e-8)
            weights.append((inv_n / prob) ** self.per_beta)

        max_w = max(weights) if weights else 1.0
        return indices, [w / max_w for w in weights]

    def _train_batch(self) -> None:
        indices, is_weights = self._sample_prioritized()
        grads = self.q_net.zero_grads()
        total_loss = 0.0
        n_act = self.action_dim

        for idx, is_w in zip(indices, is_weights):
            s, a, r, ns, done = self.replay[idx]
            raw_out, a1, a2 = self.q_net.forward_with_cache(s)
            q_pred = self._dueling_q(raw_out)

            if done:
                target = r
            else:
                next_mask = valid_mask_from_state(ns)
                next_online = self._q_values(self.q_net, ns)
                best_next_a = _masked_argmax(next_online, next_mask)
                next_target_q = self._q_values(self.target_net, ns)[best_next_a]
                target = r + self.gamma * next_target_q

            td_err = q_pred[a] - target
            prio = abs(td_err) + 0.02
            self.priorities[idx] = prio
            if prio > self.max_prio:
                self.max_prio = prio

            # Huber derivative weighted by PER importance factor
            d_q = max(-1.0, min(1.0, td_err)) * is_w
            total_loss += (0.5 * td_err * td_err if abs(td_err) <= 1.0 else (abs(td_err) - 0.5)) * is_w

            # Backprop through dueling aggregation: Q_a = V + A_a - mean(A)
            d_out = [0.0] * (n_act + 1)
            d_out[0] = d_q
            inv_n = 1.0 / n_act
            for k in range(n_act):
                d_out[1 + k] = d_q * ((1.0 if k == a else 0.0) - inv_n)

            self.q_net.backward_accumulate(s, a1, a2, d_out, grads)

        self.q_net.adamw_step(grads, lr=self.lr, scale=1.0 / self.batch_size)
        self.last_loss = total_loss / self.batch_size

    def end_episode(self, progress: float = 0.0) -> Dict[str, float]:
        self.epsilon = max(self.epsilon_min, self.epsilon * self.epsilon_decay)
        self.per_beta = min(1.0, 0.45 + 0.55 * progress)
        # Cosine learning rate schedule
        self.lr = self.base_lr * (0.25 + 0.75 * 0.5 * (1.0 + math.cos(math.pi * progress)))
        return {"epsilon": round(self.epsilon, 4), "loss": round(self.last_loss, 5)}

    def serialize(self) -> Dict[str, Any]:
        return {
            "algorithm": "DQN",
            "version": 2,
            "state_dim": self.state_dim,
            "action_dim": self.action_dim,
            "q_net": self.q_net.to_dict(),
        }

    @classmethod
    def deserialize(cls, data: Dict[str, Any]) -> "DQNAgent":
        agent = cls(state_dim=data["state_dim"], action_dim=data["action_dim"])
        agent.q_net = DeepMLP.from_dict(data["q_net"])
        agent.epsilon = 0.0
        return agent


class PPOAgent(BaseAgent):
    """Clipped PPO with GAE, action masking, and entropy annealing."""

    name = "PPO"

    def __init__(
        self,
        state_dim: int,
        action_dim: int = 3,
        lr: float = 0.0025,
        gamma: float = 0.97,
        gae_lambda: float = 0.93,
        clip_eps: float = 0.2,
        entropy_coef: float = 0.02,
        ppo_epochs: int = 3,
        seed: int = 42,
    ):
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.base_lr = lr
        self.lr = lr
        self.gamma = gamma
        self.gae_lambda = gae_lambda
        self.clip_eps = clip_eps
        self.base_entropy = entropy_coef
        self.entropy_coef = entropy_coef
        self.ppo_epochs = ppo_epochs
        self.rng = random.Random(seed)

        self.actor = DeepMLP(state_dim, 28, 16, action_dim, self.rng)
        self.critic = DeepMLP(state_dim, 28, 16, 1, self.rng)
        self.trajectory: List[Tuple[List[float], int, float, float, float, bool, List[bool]]] = []
        self.last_entropy = 0.0
        self.last_loss = 0.0
        self._pending_logp = 0.0
        self._pending_val = 0.0
        self._pending_mask: List[bool] = [True, True, True]

    def select_action(
        self,
        state: List[float],
        greedy: bool = False,
        valid_mask: Optional[List[bool]] = None,
    ) -> int:
        mask = valid_mask or valid_mask_from_state(state)
        logits = self.actor.forward(state)
        probs = _masked_softmax(logits, mask)
        if greedy:
            return _masked_argmax(probs, mask)
        action = _sample_categorical(probs, self.rng)
        self._pending_logp = math.log(max(probs[action], 1e-9))
        self._pending_val = self.critic.forward(state)[0]
        self._pending_mask = mask
        return action

    def predict_signal(self, state: List[float], valid_mask: Optional[List[bool]] = None) -> Dict[str, Any]:
        mask = valid_mask or [True, True, True]
        probs = _masked_softmax(self.actor.forward(state), mask)
        val = self.critic.forward(state)[0]
        return {
            "action": _masked_argmax(probs, mask),
            "holdProb": round(probs[0], 4),
            "buyProb": round(probs[1], 4),
            "sellProb": round(probs[2], 4),
            "stateValue": round(val, 4),
        }

    def observe(self, state: List[float], action: int, reward: float, next_state: List[float], done: bool) -> None:
        self.trajectory.append(
            (state, action, reward, self._pending_logp, self._pending_val, done, self._pending_mask)
        )

    def end_episode(self, progress: float = 0.0) -> Dict[str, float]:
        if not self.trajectory:
            return {"entropy": 0.0, "loss": 0.0}

        n = len(self.trajectory)
        advantages = [0.0] * n
        returns = [0.0] * n
        gae = 0.0
        next_val = 0.0

        for t in reversed(range(n)):
            _, _, r, _, val, done, _ = self.trajectory[t]
            m = 0.0 if done else 1.0
            delta = r + self.gamma * next_val * m - val
            gae = delta + self.gamma * self.gae_lambda * m * gae
            advantages[t] = gae
            returns[t] = gae + val
            next_val = val

        mean_a = sum(advantages) / n
        std_a = math.sqrt(sum((a - mean_a) ** 2 for a in advantages) / max(1, n)) + 1e-8
        norm_adv = [(a - mean_a) / std_a for a in advantages]

        total_entropy = 0.0
        total_vloss = 0.0
        indices = list(range(n))

        for _ in range(self.ppo_epochs):
            self.rng.shuffle(indices)
            for start in range(0, n, 32):
                batch_idx = indices[start : start + 32]
                a_grads = self.actor.zero_grads()
                c_grads = self.critic.zero_grads()

                for t in batch_idx:
                    s, act, _, old_logp, _, _, mask = self.trajectory[t]
                    adv = norm_adv[t]
                    ret = returns[t]

                    logits, a1, a2 = self.actor.forward_with_cache(s)
                    probs = _masked_softmax(logits, mask)
                    logp = math.log(max(probs[act], 1e-9))
                    ratio = math.exp(max(-4.0, min(4.0, logp - old_logp)))

                    if (adv >= 0 and ratio <= 1.0 + self.clip_eps) or (adv < 0 and ratio >= 1.0 - self.clip_eps):
                        pg_weight = -ratio * adv
                    else:
                        pg_weight = 0.0

                    entropy = -sum(p * math.log(max(p, 1e-9)) for p in probs if p > 0.0)
                    total_entropy += entropy

                    d_logits = [0.0] * self.action_dim
                    for k in range(self.action_dim):
                        if not mask[k]:
                            continue
                        d_pg = pg_weight * ((1.0 if k == act else 0.0) - probs[k])
                        d_ent = self.entropy_coef * probs[k] * (math.log(max(probs[k], 1e-9)) + entropy)
                        d_logits[k] = d_pg + d_ent

                    self.actor.backward_accumulate(s, a1, a2, d_logits, a_grads)

                    v_out, c1, c2 = self.critic.forward_with_cache(s)
                    v_err = v_out[0] - ret
                    total_vloss += 0.5 * v_err * v_err
                    self.critic.backward_accumulate(s, c1, c2, [max(-2.0, min(2.0, v_err))], c_grads)

                scale = 1.0 / max(1, len(batch_idx))
                self.actor.adamw_step(a_grads, lr=self.lr, scale=scale)
                self.critic.adamw_step(c_grads, lr=self.lr * 1.4, scale=scale)

        self.trajectory.clear()
        self.lr = self.base_lr * (0.25 + 0.75 * 0.5 * (1.0 + math.cos(math.pi * progress)))
        self.entropy_coef = self.base_entropy * max(0.25, 1.0 - 0.75 * progress)

        denom = max(1, n * self.ppo_epochs)
        self.last_entropy = total_entropy / denom
        self.last_loss = total_vloss / denom
        return {"entropy": round(self.last_entropy, 4), "loss": round(self.last_loss, 5)}

    def serialize(self) -> Dict[str, Any]:
        return {
            "algorithm": "PPO",
            "version": 2,
            "state_dim": self.state_dim,
            "action_dim": self.action_dim,
            "actor": self.actor.to_dict(),
            "critic": self.critic.to_dict(),
        }

    @classmethod
    def deserialize(cls, data: Dict[str, Any]) -> "PPOAgent":
        agent = cls(state_dim=data["state_dim"], action_dim=data["action_dim"])
        agent.actor = DeepMLP.from_dict(data["actor"])
        agent.critic = DeepMLP.from_dict(data["critic"])
        return agent


class A2CAgent(BaseAgent):
    """Advantage Actor-Critic with n-step returns and action masking."""

    name = "A2C"

    def __init__(
        self,
        state_dim: int,
        action_dim: int = 3,
        lr: float = 0.0025,
        gamma: float = 0.97,
        entropy_coef: float = 0.015,
        n_steps: int = 16,
        seed: int = 42,
    ):
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.base_lr = lr
        self.lr = lr
        self.gamma = gamma
        self.base_entropy = entropy_coef
        self.entropy_coef = entropy_coef
        self.n_steps = n_steps
        self.rng = random.Random(seed)

        self.actor = DeepMLP(state_dim, 24, 14, action_dim, self.rng)
        self.critic = DeepMLP(state_dim, 24, 14, 1, self.rng)
        self.buffer: List[Tuple[List[float], int, float, List[float], bool, List[bool]]] = []
        self._pending_mask: List[bool] = [True, True, True]
        self.last_entropy = 0.0
        self.last_loss = 0.0

    def select_action(
        self,
        state: List[float],
        greedy: bool = False,
        valid_mask: Optional[List[bool]] = None,
    ) -> int:
        mask = valid_mask or valid_mask_from_state(state)
        self._pending_mask = mask
        probs = _masked_softmax(self.actor.forward(state), mask)
        if greedy:
            return _masked_argmax(probs, mask)
        return _sample_categorical(probs, self.rng)

    def predict_signal(self, state: List[float], valid_mask: Optional[List[bool]] = None) -> Dict[str, Any]:
        mask = valid_mask or [True, True, True]
        probs = _masked_softmax(self.actor.forward(state), mask)
        val = self.critic.forward(state)[0]
        return {
            "action": _masked_argmax(probs, mask),
            "holdProb": round(probs[0], 4),
            "buyProb": round(probs[1], 4),
            "sellProb": round(probs[2], 4),
            "stateValue": round(val, 4),
        }

    def observe(self, state: List[float], action: int, reward: float, next_state: List[float], done: bool) -> None:
        self.buffer.append((state, action, reward, next_state, done, self._pending_mask))
        if len(self.buffer) >= self.n_steps or done:
            self._update()

    def _update(self) -> None:
        if not self.buffer:
            return
        last_ns = self.buffer[-1][3]
        last_done = self.buffer[-1][4]
        R = 0.0 if last_done else self.critic.forward(last_ns)[0]

        a_grads = self.actor.zero_grads()
        c_grads = self.critic.zero_grads()
        ent_acc = 0.0
        vloss_acc = 0.0
        m = len(self.buffer)

        for s, act, r, _, done, mask in reversed(self.buffer):
            R = r + (0.0 if done else self.gamma * R)
            v_out, c1, c2 = self.critic.forward_with_cache(s)
            adv = R - v_out[0]
            vloss_acc += 0.5 * adv * adv

            logits, a1, a2 = self.actor.forward_with_cache(s)
            probs = _masked_softmax(logits, mask)
            entropy = -sum(p * math.log(max(p, 1e-9)) for p in probs if p > 0.0)
            ent_acc += entropy

            d_logits = [0.0] * self.action_dim
            clipped_adv = max(-3.0, min(3.0, adv))
            for k in range(self.action_dim):
                if not mask[k]:
                    continue
                d_pg = -clipped_adv * ((1.0 if k == act else 0.0) - probs[k])
                d_ent = self.entropy_coef * probs[k] * (math.log(max(probs[k], 1e-9)) + entropy)
                d_logits[k] = d_pg + d_ent

            self.actor.backward_accumulate(s, a1, a2, d_logits, a_grads)
            self.critic.backward_accumulate(s, c1, c2, [max(-2.0, min(2.0, -adv))], c_grads)

        self.actor.adamw_step(a_grads, lr=self.lr, scale=1.0 / m)
        self.critic.adamw_step(c_grads, lr=self.lr * 1.4, scale=1.0 / m)
        self.last_entropy = ent_acc / m
        self.last_loss = vloss_acc / m
        self.buffer.clear()

    def end_episode(self, progress: float = 0.0) -> Dict[str, float]:
        self._update()
        self.lr = self.base_lr * (0.25 + 0.75 * 0.5 * (1.0 + math.cos(math.pi * progress)))
        self.entropy_coef = self.base_entropy * max(0.25, 1.0 - 0.75 * progress)
        return {"entropy": round(self.last_entropy, 4), "loss": round(self.last_loss, 5)}

    def serialize(self) -> Dict[str, Any]:
        return {
            "algorithm": "A2C",
            "version": 2,
            "state_dim": self.state_dim,
            "action_dim": self.action_dim,
            "actor": self.actor.to_dict(),
            "critic": self.critic.to_dict(),
        }

    @classmethod
    def deserialize(cls, data: Dict[str, Any]) -> "A2CAgent":
        agent = cls(state_dim=data["state_dim"], action_dim=data["action_dim"])
        agent.actor = DeepMLP.from_dict(data["actor"])
        agent.critic = DeepMLP.from_dict(data["critic"])
        return agent


class TabularQLearningAgent(BaseAgent):
    """Regime-aware tabular Q-Learning with valid action masking."""

    name = "Q-Learning"

    def __init__(
        self,
        state_dim: int,
        action_dim: int = 3,
        lr: float = 0.08,
        gamma: float = 0.96,
        epsilon_start: float = 0.85,
        epsilon_min: float = 0.04,
        epsilon_decay: float = 0.91,
        seed: int = 42,
    ):
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.base_lr = lr
        self.lr = lr
        self.gamma = gamma
        self.epsilon = epsilon_start
        self.epsilon_min = epsilon_min
        self.epsilon_decay = epsilon_decay
        self.rng = random.Random(seed)
        self.q_table: Dict[str, List[float]] = {}
        self.last_td_error = 0.0

    def _discretize(self, state: List[float]) -> str:
        def _bin(v: float, edges: Tuple[float, ...]) -> int:
            for idx, e in enumerate(edges):
                if v < e:
                    return idx
            return len(edges)

        # Pick key regime features: ret5, ema_trend, rsi, adx_signed, donchian, holding
        b_ret = _bin(state[2], (-0.7, 0.7))
        b_trend = _bin(state[5], (-0.6, 0.6))
        b_rsi = _bin(state[8], (-0.8, 0.8))
        b_adx = _bin(state[9], (-0.5, 0.5))
        b_ch = _bin(state[13], (-0.6, 0.6))
        b_pos = 1 if state[-4] > 0.25 else 0
        return f"{b_ret}:{b_trend}:{b_rsi}:{b_adx}:{b_ch}:{b_pos}"

    def _get_q(self, key: str) -> List[float]:
        if key not in self.q_table:
            self.q_table[key] = [0.0] * self.action_dim
        return self.q_table[key]

    def select_action(
        self,
        state: List[float],
        greedy: bool = False,
        valid_mask: Optional[List[bool]] = None,
    ) -> int:
        mask = valid_mask or valid_mask_from_state(state)
        if not greedy and self.rng.random() < self.epsilon:
            legal = [i for i, ok in enumerate(mask) if ok]
            return self.rng.choice(legal)
        q = self._get_q(self._discretize(state))
        return _masked_argmax(q, mask)

    def predict_signal(self, state: List[float], valid_mask: Optional[List[bool]] = None) -> Dict[str, Any]:
        mask = valid_mask or [True, True, True]
        q = self._get_q(self._discretize(state))
        spread = max(0.2, max(q) - min(q))
        probs = _masked_softmax([v / (spread * 0.7) for v in q], mask)
        return {
            "action": _masked_argmax(q, mask),
            "holdProb": round(probs[0], 4),
            "buyProb": round(probs[1], 4),
            "sellProb": round(probs[2], 4),
            "qValues": [round(v, 4) for v in q],
        }

    def observe(self, state: List[float], action: int, reward: float, next_state: List[float], done: bool) -> None:
        k = self._discretize(state)
        nk = self._discretize(next_state)
        q = self._get_q(k)
        nq = self._get_q(nk)
        next_mask = valid_mask_from_state(next_state)
        best_next = nq[_masked_argmax(nq, next_mask)]
        target = reward if done else reward + self.gamma * best_next
        td = target - q[action]
        q[action] += self.lr * td
        self.last_td_error = abs(td)

    def end_episode(self, progress: float = 0.0) -> Dict[str, float]:
        self.epsilon = max(self.epsilon_min, self.epsilon * self.epsilon_decay)
        self.lr = self.base_lr * max(0.35, 1.0 - 0.65 * progress)
        return {
            "epsilon": round(self.epsilon, 4),
            "loss": round(self.last_td_error, 5),
            "statesVisited": float(len(self.q_table)),
        }

    def serialize(self) -> Dict[str, Any]:
        return {
            "algorithm": "Q-Learning",
            "version": 2,
            "state_dim": self.state_dim,
            "action_dim": self.action_dim,
            "q_table": self.q_table,
        }

    @classmethod
    def deserialize(cls, data: Dict[str, Any]) -> "TabularQLearningAgent":
        agent = cls(state_dim=data["state_dim"], action_dim=data["action_dim"])
        agent.q_table = {k: list(v) for k, v in data["q_table"].items()}
        agent.epsilon = 0.0
        return agent


def create_agent(
    algorithm: str,
    state_dim: int,
    learning_rate: float,
    gamma: float,
    exploration: float,
    seed: int,
) -> BaseAgent:
    algo = algorithm.upper()
    if algo == "DQN":
        return DQNAgent(
            state_dim=state_dim,
            lr=learning_rate,
            gamma=gamma,
            epsilon_start=max(0.15, min(1.0, exploration)),
            seed=seed,
        )
    if algo == "PPO":
        return PPOAgent(
            state_dim=state_dim,
            lr=learning_rate,
            gamma=gamma,
            entropy_coef=max(0.001, min(0.12, exploration * 0.035)),
            seed=seed,
        )
    if algo == "A2C":
        return A2CAgent(
            state_dim=state_dim,
            lr=learning_rate,
            gamma=gamma,
            entropy_coef=max(0.001, min(0.12, exploration * 0.028)),
            seed=seed,
        )
    if algo in ("Q-LEARNING", "Q_LEARNING", "TABULAR"):
        alpha = max(0.02, min(0.45, learning_rate * 25.0 if learning_rate < 0.02 else learning_rate))
        return TabularQLearningAgent(
            state_dim=state_dim,
            lr=alpha,
            gamma=gamma,
            epsilon_start=max(0.15, min(1.0, exploration)),
            seed=seed,
        )
    raise ValueError(f"Unsupported algorithm: {algorithm}")


def deserialize_agent(data: Dict[str, Any]) -> BaseAgent:
    algo = str(data.get("algorithm", "")).upper()
    if algo == "DQN":
        return DQNAgent.deserialize(data)
    if algo == "PPO":
        return PPOAgent.deserialize(data)
    if algo == "A2C":
        return A2CAgent.deserialize(data)
    if algo in ("Q-LEARNING", "Q_LEARNING", "TABULAR"):
        return TabularQLearningAgent.deserialize(data)
    raise ValueError(f"Unknown serialized agent algorithm: {algo}")
