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
    if denom == 0.0 { 0.0 } else { dot / denom }
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

/// Leiden法による再帰的クラスタリング
///
/// - file_embeddings: (ファイルパス, embedding) のペア
/// - similarity_threshold: cosine類似度がこの値以上のペアにエッジを張る（デフォルト0.3）
pub fn build_cluster_tree(
    file_embeddings: &[(String, Vec<f32>)],
    similarity_threshold: f32,
) -> ClusterTree {
    let n = file_embeddings.len();

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

    if n <= 1 {
        return ClusterTree { levels: vec![file_nodes] };
    }

    // 類似度グラフを構築
    let mut graph = fa_leiden_cd::Graph::<(), ()>::new();
    for _ in 0..n {
        graph.add_node(());
    }

    for i in 0..n {
        for j in (i + 1)..n {
            let sim = cosine_similarity(&file_embeddings[i].1, &file_embeddings[j].1);
            if sim >= similarity_threshold {
                graph.add_edge(i, j, (), sim);
            }
        }
    }

    // Leiden実行
    let mut optimizer = fa_leiden_cd::TrivialModularityOptimizer {
        parallel_scale: 100,
        tol: 1e-6,
    };
    let result = graph.leiden(Some(100), &mut optimizer);
    let communities = result.node_data_slice();

    // Community階層をClusterTreeに変換
    let mut levels: Vec<Vec<ClusterNode>> = vec![file_nodes];
    flatten_communities(communities, file_embeddings, &mut levels, 1);

    // parent_idを設定
    for level_idx in 1..levels.len() {
        let parent_child_pairs: Vec<(String, Vec<String>)> = levels[level_idx]
            .iter()
            .map(|n| (n.id.clone(), n.child_ids.clone()))
            .collect();

        for (parent_id, child_ids) in &parent_child_pairs {
            for child_id in child_ids {
                if let Some(child) = levels[level_idx - 1].iter_mut().find(|n| &n.id == child_id) {
                    child.parent_id = Some(parent_id.clone());
                }
            }
        }
    }

    ClusterTree { levels }
}

/// Community列をClusterTreeのレベルに変換する
fn flatten_communities(
    communities: &[fa_leiden_cd::Community],
    file_embeddings: &[(String, Vec<f32>)],
    levels: &mut Vec<Vec<ClusterNode>>,
    level_idx: usize,
) {
    let mut current_level: Vec<ClusterNode> = Vec::new();
    let mut has_deeper = false;
    let mut sub_communities_list: Vec<&[fa_leiden_cd::Community]> = Vec::new();

    for (comm_idx, community) in communities.iter().enumerate() {
        let cluster_id = format!("L{}C{}", level_idx, comm_idx);

        // 配下の全ファイルインデックスを収集
        let file_indices_cell = std::cell::RefCell::new(Vec::new());
        community.collect_nodes(&|node_idx| {
            file_indices_cell.borrow_mut().push(node_idx);
        });
        let mut file_indices = file_indices_cell.into_inner();
        file_indices.sort();

        let file_paths: Vec<String> = file_indices
            .iter()
            .filter_map(|&idx| file_embeddings.get(idx).map(|(p, _)| p.clone()))
            .collect();

        // centroid = 配下全ファイルのembedding平均
        let file_vecs: Vec<&Vec<f32>> = file_indices
            .iter()
            .filter_map(|&idx| file_embeddings.get(idx).map(|(_, emb)| emb))
            .collect();
        let centroid = compute_centroid(&file_vecs);

        // child_idsはこのレベルの子ノード
        let child_ids: Vec<String> = match community {
            fa_leiden_cd::Community::L1Community(nodes) => {
                nodes.iter().map(|&idx| file_embeddings[idx].0.clone()).collect()
            }
            fa_leiden_cd::Community::LNCommunity(sub_comms) => {
                has_deeper = true;
                sub_communities_list.push(sub_comms);
                sub_comms
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("L{}C{}", level_idx + 1, i))
                    .collect()
            }
        };

        current_level.push(ClusterNode {
            id: cluster_id,
            centroid,
            file_paths,
            child_ids,
            parent_id: None,
            label: None,
        });
    }

    levels.push(current_level);

    // LNCommunityがある場合、そのサブコミュニティで次のレベルを構築
    if has_deeper {
        let mut all_sub: Vec<&fa_leiden_cd::Community> = Vec::new();
        for subs in &sub_communities_list {
            for sub in *subs {
                all_sub.push(sub);
            }
        }

        // サブコミュニティをフラット化して次レベルのノードを構築
        let mut next_level: Vec<ClusterNode> = Vec::new();
        let mut has_next_deeper = false;

        for (sub_idx, sub_comm) in all_sub.iter().enumerate() {
            let cluster_id = format!("L{}C{}", level_idx + 1, sub_idx);

            let file_indices_cell = std::cell::RefCell::new(Vec::new());
            sub_comm.collect_nodes(&|node_idx| {
                file_indices_cell.borrow_mut().push(node_idx);
            });
            let mut file_indices = file_indices_cell.into_inner();
            file_indices.sort();

            let file_paths: Vec<String> = file_indices
                .iter()
                .filter_map(|&idx| file_embeddings.get(idx).map(|(p, _)| p.clone()))
                .collect();

            let file_vecs: Vec<&Vec<f32>> = file_indices
                .iter()
                .filter_map(|&idx| file_embeddings.get(idx).map(|(_, emb)| emb))
                .collect();
            let centroid = compute_centroid(&file_vecs);

            let child_ids: Vec<String> = match sub_comm {
                fa_leiden_cd::Community::L1Community(nodes) => {
                    nodes.iter().map(|&idx| file_embeddings[idx].0.clone()).collect()
                }
                fa_leiden_cd::Community::LNCommunity(_) => {
                    has_next_deeper = true;
                    vec![] // deeper levels not handled in this MVP
                }
            };

            next_level.push(ClusterNode {
                id: cluster_id,
                centroid,
                file_paths,
                child_ids,
                parent_id: None,
                label: None,
            });
        }

        if !next_level.is_empty() {
            // parent_idを設定
            let parent_child: Vec<(String, Vec<String>)> = levels[level_idx]
                .iter()
                .map(|n| (n.id.clone(), n.child_ids.clone()))
                .collect();
            for (parent_id, child_ids) in &parent_child {
                for child_id in child_ids {
                    if let Some(child) = next_level.iter_mut().find(|n| &n.id == child_id) {
                        child.parent_id = Some(parent_id.clone());
                    }
                }
            }
            levels.push(next_level);
        }

        let _ = has_next_deeper;
    }
}
