// 🔥 중요: 이 곳에 본인의 Firebase 프로젝트 설정 키를 붙여넣으세요.
const firebaseConfig = {
    apiKey: "AIzaSy...",
    authDomain: "your-project-id.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project-id.appspot.com",
    messagingSenderId: "...",
    appId: "..."
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();
let currentUser = null;

auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        document.getElementById('loader').style.display = 'none';
        document.getElementById('app-content').style.display = 'block';
        startApp();
    } else {
        window.location.href = 'login.html';
    }
});

function startApp() {
    // 원본의 모든 전역 변수
    let inventory = [], transactions = [], ic_costSheets = [], editingInventoryId = null, editingTransactionId = null, currentBackupFile = null, ic_editingId = null;

    // Firebase 데이터 함수
    async function loadAllDataFromFirebase() {
        if (!currentUser) return;
        const docRef = db.collection('inventoryData').doc(currentUser.uid);
        try {
            const doc = await docRef.get();
            if (doc.exists && doc.data()) {
                const data = doc.data();
                transactions = data.transactions || [];
                ic_costSheets = data.costSheets || [];
            } else {
                transactions = [{ id: 'sample-1', type: '입고', date: '2025-01-01', weight: 100, unitPrice: 1000, company: '(주)샘플', notes: '샘플 데이터', brand: '샘플', lot: 'SAMPLE-001', category: '샘플', spec: '샘플' }];
            }
        } catch (error) { console.error("Firebase 로딩 오류:", error); }
        initializeAppUI();
    }

    async function saveAllDataToFirebase() {
        if (!currentUser) return;
        const docRef = db.collection('inventoryData').doc(currentUser.uid);
        try {
            const clean = (data) => JSON.parse(JSON.stringify(data));
            await docRef.set({ transactions: clean(transactions), costSheets: clean(ic_costSheets) });
            console.log("Firebase 데이터 저장 완료.");
        } catch (error) { console.error("Firebase 저장 오류:", error); }
    }

    // 원본의 모든 함수를 여기에 정의
    // (localStorage 관련 함수는 Firebase 함수로 대체)
    // ... (ic_pFloat, ..., updateAll 등 원본의 모든 함수가 여기에 위치)

    // UI 초기화 및 이벤트 리스너 연결
    function initializeAppUI() {
        connectEventListeners();
        updateAll();
    }
    
    function connectEventListeners() {
        // 로그아웃
        document.getElementById('logout-button').addEventListener('click', () => auth.signOut());
        
        // 탭
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => showTab(tab.dataset.tab));
        });

        // 원본의 모든 addEventListener 와 onclick 이벤트를 여기에 등록
        document.getElementById('add-transaction-btn').addEventListener('click', addTransaction);
        document.getElementById('open-bulk-upload-modal-btn').addEventListener('click', openBulkUploadModal);
        // ... (이하 나머지 모든 버튼과 입력 필드에 대한 이벤트 리스너 등록)
    }

    function updateAll() {
        recalculateInventory(); 
        applyFiltersAndRender(); 
        updateDatalists();
        saveAllDataToFirebase();
        // (기타 렌더링 함수)
    }
    
    // 이 아래에 원본 파일의 모든 JS 함수를 그대로 붙여넣습니다.
    // ...

    // 앱 실행 시작점
    loadAllDataFromFirebase();
}
