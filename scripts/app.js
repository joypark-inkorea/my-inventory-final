// 🔥 중요: 이 곳에 본인의 Firebase 프로젝트 설정 키를 붙여넣으세요.
const firebaseConfig = {
apiKey: "AIzaSyDA0BNmhnr37KqyI7oj766TwB8FrejsRzo",
  authDomain: "my-inventory-final.firebaseapp.com",
  projectId: "my-inventory-final",
  storageBucket: "my-inventory-final.firebasestorage.app",
  messagingSenderId: "740246970535",
  appId: "1:740246970535:web:f7738b92a6097671f67b82",
  measurementId: "G-4ZF63VWX6Z"

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
                transactions = [{ id: 'sample-1', type: '입고', date: '2025-07-01', weight: 150, unitPrice: 8500, company: '(주)섬유나라', notes: '정기입고', destination: '본사 창고', specialNotes: '', brand: 'TRIZAR', lot: 'CM-2025-01', category: 'PET SD DTY', spec: '150d/96f' }];
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
        // 원본의 DOMContentLoaded 내부 로직
        transactions = transactions.map(t => ({...t, id: t.id || generateUniqueTransactionId(t)}));
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
        // ... (모든 버튼과 입력 필드 등)
    }

    function updateAll() {
        recalculateInventory(); 
        applyFiltersAndRender(); 
        updateDatalists();
        saveAllDataToFirebase();
        generateSalesReport(); 
        ic_renderList();
    }
    
    // 이 아래에 원본 파일의 모든 JS 함수를 그대로 붙여넣습니다.
    // ...

    // 앱 실행 시작점
    loadAllDataFromFirebase();
}
