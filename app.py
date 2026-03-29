#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
학습 마인드맵 - 웹 서버 (Flask)
클라우드 배포 가능 / Mac·iPad·iPhone 연동
"""

import os
import json
import time
import uuid
from flask import Flask, render_template, request, jsonify, send_from_directory

app = Flask(__name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)


def _maps_index_path():
    return os.path.join(DATA_DIR, "_index.json")


def _map_path(map_id):
    return os.path.join(DATA_DIR, f"{map_id}.json")


def _load_index():
    path = _maps_index_path()
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _save_index(index):
    with open(_maps_index_path(), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)


def _load_map(map_id):
    path = _map_path(map_id)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def _save_map(map_id, data):
    data["updated_at"] = time.time()
    with open(_map_path(map_id), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    # 인덱스 업데이트
    index = _load_index()
    index[map_id] = {
        "title": data.get("title", "제목 없음"),
        "node_count": len(data.get("nodes", {})),
        "edge_count": len(data.get("edges", {})),
        "updated_at": data["updated_at"]
    }
    _save_index(index)


# ── 페이지 ──

@app.route("/")
def index():
    return render_template("index.html")


# ── API: 맵 목록 ──

@app.route("/api/maps", methods=["GET"])
def list_maps():
    index = _load_index()
    maps = []
    for mid, info in sorted(index.items(), key=lambda x: x[1].get("updated_at", 0), reverse=True):
        maps.append({"id": mid, **info})
    return jsonify(maps)


@app.route("/api/maps", methods=["POST"])
def create_map():
    map_id = str(uuid.uuid4())[:8]
    body = request.get_json(silent=True) or {}
    data = {
        "title": body.get("title", "새 마인드맵"),
        "nodes": body.get("nodes", {}),
        "edges": body.get("edges", {}),
        "created_at": time.time(),
        "updated_at": time.time()
    }
    _save_map(map_id, data)
    return jsonify({"id": map_id, "title": data["title"]}), 201


# ── API: 개별 맵 ──

@app.route("/api/maps/<map_id>", methods=["GET"])
def get_map(map_id):
    data = _load_map(map_id)
    if not data:
        return jsonify({"error": "not found"}), 404
    return jsonify({"id": map_id, **data})


@app.route("/api/maps/<map_id>", methods=["PUT"])
def save_map(map_id):
    body = request.get_json()
    if not body:
        return jsonify({"error": "no data"}), 400

    existing = _load_map(map_id)
    if existing:
        existing["nodes"] = body.get("nodes", existing.get("nodes", {}))
        existing["edges"] = body.get("edges", existing.get("edges", {}))
        if "title" in body:
            existing["title"] = body["title"]
        _save_map(map_id, existing)
    else:
        data = {
            "title": body.get("title", "제목 없음"),
            "nodes": body.get("nodes", {}),
            "edges": body.get("edges", {}),
            "created_at": time.time()
        }
        _save_map(map_id, data)

    return jsonify({"status": "saved", "id": map_id})


@app.route("/api/maps/<map_id>", methods=["DELETE"])
def delete_map(map_id):
    path = _map_path(map_id)
    if os.path.exists(path):
        os.remove(path)
    index = _load_index()
    index.pop(map_id, None)
    _save_index(index)
    return jsonify({"status": "deleted"})


# ── API: 개별 노드/엣지 조작 (모바일 최적화) ──

@app.route("/api/maps/<map_id>/node", methods=["POST"])
def add_node(map_id):
    data = _load_map(map_id)
    if not data:
        return jsonify({"error": "map not found"}), 404

    body = request.get_json()
    node_id = body.get("id", str(uuid.uuid4())[:8])
    data.setdefault("nodes", {})[node_id] = {
        "x": body.get("x", 400),
        "y": body.get("y", 300),
        "title": body.get("title", "새 노드"),
        "detail": body.get("detail", ""),
        "color": body.get("color", "#4FC3F7"),
        "radius": body.get("radius", 45)
    }
    _save_map(map_id, data)
    return jsonify({"status": "added", "node_id": node_id})


@app.route("/api/maps/<map_id>/node/<node_id>", methods=["PUT"])
def update_node(map_id, node_id):
    data = _load_map(map_id)
    if not data or node_id not in data.get("nodes", {}):
        return jsonify({"error": "not found"}), 404

    body = request.get_json()
    node = data["nodes"][node_id]
    for key in ("x", "y", "title", "detail", "color", "radius"):
        if key in body:
            node[key] = body[key]
    _save_map(map_id, data)
    return jsonify({"status": "updated"})


@app.route("/api/maps/<map_id>/node/<node_id>", methods=["DELETE"])
def delete_node(map_id, node_id):
    data = _load_map(map_id)
    if not data:
        return jsonify({"error": "map not found"}), 404

    data.get("nodes", {}).pop(node_id, None)
    # 관련 엣지도 삭제
    edges = data.get("edges", {})
    to_remove = [eid for eid, e in edges.items()
                 if e["from_id"] == node_id or e["to_id"] == node_id]
    for eid in to_remove:
        del edges[eid]

    _save_map(map_id, data)
    return jsonify({"status": "deleted"})


@app.route("/api/maps/<map_id>/edge", methods=["POST"])
def add_edge(map_id):
    data = _load_map(map_id)
    if not data:
        return jsonify({"error": "map not found"}), 404

    body = request.get_json()
    edge_id = body.get("id", str(uuid.uuid4())[:8])
    data.setdefault("edges", {})[edge_id] = {
        "from_id": body["from_id"],
        "to_id": body["to_id"],
        "label": body.get("label", ""),
        "detail": body.get("detail", "")
    }
    _save_map(map_id, data)
    return jsonify({"status": "added", "edge_id": edge_id})


@app.route("/api/maps/<map_id>/edge/<edge_id>", methods=["DELETE"])
def delete_edge(map_id, edge_id):
    data = _load_map(map_id)
    if not data:
        return jsonify({"error": "map not found"}), 404
    data.get("edges", {}).pop(edge_id, None)
    _save_map(map_id, data)
    return jsonify({"status": "deleted"})


# ── 기존 데스크톱 JSON 가져오기 ──

@app.route("/api/import-desktop", methods=["POST"])
def import_desktop():
    """기존 tkinter 버전의 .json 파일을 가져오기"""
    body = request.get_json()
    if not body:
        return jsonify({"error": "no data"}), 400

    map_id = str(uuid.uuid4())[:8]
    data = {
        "title": body.get("title", "가져온 마인드맵"),
        "nodes": body.get("nodes", {}),
        "edges": body.get("edges", {}),
        "created_at": time.time()
    }
    _save_map(map_id, data)
    return jsonify({"id": map_id, "title": data["title"]}), 201


# ── PWA 매니페스트 ──

@app.route("/manifest.json")
def manifest():
    m = {
        "name": "학습 마인드맵",
        "short_name": "마인드맵",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#1E1E2E",
        "theme_color": "#4FC3F7",
        "icons": [
            {"src": "/static/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/static/icon-512.png", "sizes": "512x512", "type": "image/png"}
        ]
    }
    return jsonify(m)


@app.route("/sw.js")
def service_worker():
    return send_from_directory("static", "sw.js", mimetype="application/javascript")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
