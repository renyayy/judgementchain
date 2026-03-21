use rand::Rng;

/// クラスタリング結果の階層構造
pub struct ClusterTree {
    /// levels[0] = ファイルノード, levels[1] = 最初のクラスタ, levels[2] = ...
    pub levels: Vec<Vec<ClusterNode>>,
}

/// 各クラスタ（または最下層のファイル）を表すノード
pub struct ClusterNode {
    pub id: String,
    pub centroid: Vec<f32>,
    pub file_paths: Vec<String>,
    pub child_ids: Vec<String>,
    pub parent_id: Option<String>,
    pub label: Option<String>,
}

/// cosine類似度
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut mag_a = 0.0f32;
    let mut mag_b = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        mag_a += a[i] * a[i];
        mag_b += b[i] * b[i];
    }
    let denom = mag_a.sqrt() * mag_b.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

/// ベクトル群の要素平均（centroid）を計算
pub fn compute_centroid(vectors: &[&Vec<f32>]) -> Vec<f32> {
    if vectors.is_empty() {
        return vec![];
    }
    let dim = vectors[0].len();
    let mut centroid = vec![0.0f32; dim];
    for v in vectors {
        for (i, val) in v.iter().enumerate() {
            centroid[i] += val;
        }
    }
    let n = vectors.len() as f32;
    for val in centroid.iter_mut() {
        *val /= n;
    }
    centroid
}

/// k-means++ 初期化: cosine距離ベースで初期centroidを選択
fn kmeans_plus_plus_init(vectors: &[Vec<f32>], k: usize) -> Vec<Vec<f32>> {
    let mut rng = rand::thread_rng();
    let n = vectors.len();
    let mut centroids: Vec<Vec<f32>> = Vec::with_capacity(k);

    // 最初のcentroidをランダムに選択
    centroids.push(vectors[rng.gen_range(0..n)].clone());

    for _ in 1..k {
        // 各点から最も近いcentroidまでの距離を計算
        let mut distances: Vec<f32> = vectors
            .iter()
            .map(|v| {
                centroids
                    .iter()
                    .map(|c| 1.0 - cosine_similarity(v, c)) // cosine距離
                    .fold(f32::MAX, f32::min)
            })
            .collect();

        // 距離の2乗で重み付きランダム選択
        for d in distances.iter_mut() {
            *d = (*d) * (*d);
        }
        let total: f32 = distances.iter().sum();
        if total <= 0.0 {
            centroids.push(vectors[rng.gen_range(0..n)].clone());
            continue;
        }

        let threshold = rng.gen::<f32>() * total;
        let mut cumulative = 0.0;
        let mut chosen = 0;
        for (i, d) in distances.iter().enumerate() {
            cumulative += d;
            if cumulative >= threshold {
                chosen = i;
                break;
            }
        }
        centroids.push(vectors[chosen].clone());
    }

    centroids
}

/// k-means クラスタリング（cosine距離）
/// 戻り値: 各ベクトルの所属クラスタID
pub fn kmeans(vectors: &[Vec<f32>], k: usize, max_iter: usize) -> Vec<usize> {
    let n = vectors.len();
    if n == 0 || k == 0 {
        return vec![];
    }
    let k = k.min(n); // kがnより大きい場合はnに制限

    let mut centroids = kmeans_plus_plus_init(vectors, k);
    let mut assignments = vec![0usize; n];

    for _ in 0..max_iter {
        // 割り当てステップ: 各ベクトルを最も近いcentroidに割り当て
        let mut changed = false;
        for (i, v) in vectors.iter().enumerate() {
            let mut best_cluster = 0;
            let mut best_sim = f32::MIN;
            for (j, c) in centroids.iter().enumerate() {
                let sim = cosine_similarity(v, c);
                if sim > best_sim {
                    best_sim = sim;
                    best_cluster = j;
                }
            }
            if assignments[i] != best_cluster {
                assignments[i] = best_cluster;
                changed = true;
            }
        }

        if !changed {
            break;
        }

        // 更新ステップ: 各クラスタのcentroidを再計算
        let dim = vectors[0].len();
        let mut new_centroids = vec![vec![0.0f32; dim]; k];
        let mut counts = vec![0usize; k];

        for (i, v) in vectors.iter().enumerate() {
            let cluster = assignments[i];
            counts[cluster] += 1;
            for (j, val) in v.iter().enumerate() {
                new_centroids[cluster][j] += val;
            }
        }

        for (j, centroid) in new_centroids.iter_mut().enumerate() {
            if counts[j] > 0 {
                let c = counts[j] as f32;
                for val in centroid.iter_mut() {
                    *val /= c;
                }
            } else {
                // 空クラスタ: 既存のcentroidを維持
                *centroid = centroids[j].clone();
            }
        }

        centroids = new_centroids;
    }

    assignments
}

/// 再帰的クラスタリングを実行し、ClusterTreeを構築する
///
/// - file_embeddings: (ファイルパス, embedding) のペア
/// - max_top_clusters: この数以下になったら再帰を停止
pub fn build_cluster_tree(
    file_embeddings: &[(String, Vec<f32>)],
    max_top_clusters: usize,
) -> ClusterTree {
    // Level 0: ファイルノード
    let file_nodes: Vec<ClusterNode> = file_embeddings
        .iter()
        .map(|(path, emb)| ClusterNode {
            id: path.clone(),
            centroid: emb.clone(),
            file_paths: vec![path.clone()],
            child_ids: vec![],
            parent_id: None,
            label: None,
        })
        .collect();

    let mut levels: Vec<Vec<ClusterNode>> = vec![file_nodes];

    // 再帰的にクラスタリング
    loop {
        let current_level = levels.last().unwrap();
        let current_count = current_level.len();

        // 停止条件: ノード数が上限以下
        if current_count <= max_top_clusters {
            break;
        }

        // k = ceil(sqrt(current_count))、ただし最低2、最大5（深い階層を生成するため）
        let k = (current_count as f64).sqrt().ceil() as usize;
        let k = k.max(2).min(current_count - 1).min(5);

        // 現在のレベルのcentroidでk-meansを実行
        let vectors: Vec<Vec<f32>> = current_level.iter().map(|n| n.centroid.clone()).collect();
        let assignments = kmeans(&vectors, k, 50);

        // クラスタごとにノードを集約
        let level_idx = levels.len();
        let mut cluster_map: std::collections::HashMap<usize, Vec<usize>> =
            std::collections::HashMap::new();
        for (i, &cluster_id) in assignments.iter().enumerate() {
            cluster_map.entry(cluster_id).or_default().push(i);
        }

        let mut new_level: Vec<ClusterNode> = Vec::new();
        let mut sorted_clusters: Vec<_> = cluster_map.into_iter().collect();
        sorted_clusters.sort_by_key(|(k, _)| *k);

        for (cluster_idx, (_, member_indices)) in sorted_clusters.into_iter().enumerate() {
            let cluster_id = format!("L{}C{}", level_idx, cluster_idx);

            // 配下の全ファイルパスを集約
            let mut all_file_paths: Vec<String> = Vec::new();
            let mut child_ids: Vec<String> = Vec::new();

            for &idx in &member_indices {
                let child = &levels.last().unwrap()[idx];
                all_file_paths.extend(child.file_paths.clone());
                child_ids.push(child.id.clone());
            }

            // centroid = 配下の全ファイルのembedding平均
            let file_vecs: Vec<&Vec<f32>> = all_file_paths
                .iter()
                .filter_map(|path| {
                    file_embeddings
                        .iter()
                        .find(|(p, _)| p == path)
                        .map(|(_, emb)| emb)
                })
                .collect();
            let centroid = compute_centroid(&file_vecs);

            new_level.push(ClusterNode {
                id: cluster_id.clone(),
                centroid,
                file_paths: all_file_paths,
                child_ids,
                parent_id: None,
                label: None,
            });
        }

        // 子ノードのparent_idを設定
        let parent_ids: Vec<(String, Vec<String>)> = new_level
            .iter()
            .map(|n| (n.id.clone(), n.child_ids.clone()))
            .collect();

        let last_level = levels.last_mut().unwrap();
        for (parent_id, child_ids) in &parent_ids {
            for child_id in child_ids {
                if let Some(child) = last_level.iter_mut().find(|n| &n.id == child_id) {
                    child.parent_id = Some(parent_id.clone());
                }
            }
        }

        levels.push(new_level);
    }

    ClusterTree { levels }
}
