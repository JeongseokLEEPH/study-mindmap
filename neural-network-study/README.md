# neural-network-study

인공신경망/딥러닝 필수 알고리즘을 **직접 실행하며 배우는** Jupyter 노트북 모음 (한글 주석 상세).

## 파일 목록 (권장 학습 순서)

1. `00_Overview.ipynb` — 전체 로드맵
2. `01_Perceptron_ADALINE.ipynb` — 단층 퍼셉트론 / ADALINE (numpy로 직접 구현)
3. `02_MLP.ipynb` — 다층 퍼셉트론 + 역전파 (XOR, moons)
4. `03_Boltzmann_Machine.ipynb` — RBM + CD-1 (막대 패턴 생성)
5. `04_CNN.ipynb` — CNN (합성 이미지 분류, PyTorch)
6. `05_RNN.ipynb` — RNN vs LSTM vs GRU (사인파 예측)
7. `06_GNN.ipynb` — GCN (그래프 커뮤니티 분류)
8. `07_GAN.ipynb` — GAN (2D 분포 생성)
9. `08_Transformer.ipynb` — Transformer (수열 분류 + 어텐션 heatmap)
10. `09_AutoRegressive.ipynb` — AR(2) 시계열 + MADE (자기회귀 밀도 추정)

## 실행 방법

```bash
pip install numpy matplotlib torch jupyter
jupyter lab
```

각 노트북을 위에서부터 순서대로 실행(Shift+Enter)하세요. 외부 데이터 다운로드가 필요 없습니다.
