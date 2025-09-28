// 🔥 중요: 이 곳에 본인의 Firebase 프로젝트 설정 키를 붙여넣으세요.
const firebaseConfig = {
    apiKey: "AIzaSy...",
    authDomain: "your-project-id.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project-id.appspot.com",
    messagingSenderId: "...",
    appId: "..."
};

// Firebase 앱 초기화
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();
let currentUser = null;

auth.onAuthStateChanged(user => {
    const loader = document.getElementById('loader');
    const appContent = document.getElementById('app-content');
    if (user) {
        currentUser = user;
        if (loader) loader.style.display = 'none';
        if (appContent) appContent.style.display = 'block';
        startApp();
    } else {
        window.location.href = 'login.html';
    }
});

// ===============================================================
//      ↓↓↓ 이 아래는 startApp 함수 하나로 모든 것을 관리합니다 ↓↓↓
// ===============================================================

function startApp() {
    // ----------------- 전역 변수 선언 -----------------
    let inventory = [];
    let transactions = [];
    let ic_costSheets = [];
    let editingTransactionId = null;
    let ic_editingId = null;
    // (기타 필요한 모든 변수)

    // ----------------- Firebase 데이터 관리 -----------------
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
                ic_costSheets = [];
            }
        } catch (error) {
            console.error("Firebase 데이터 로딩 오류:", error);
        }
        initializeAppUI();
    }

    async function saveAllDataToFirebase() {
        if (!currentUser) return;
        const docRef = db.collection('inventoryData').doc(currentUser.uid);
        try {
            await docRef.set({
                transactions: JSON.parse(JSON.stringify(transactions)),
                costSheets: JSON.parse(JSON.stringify(ic_costSheets))
            });
            console.log("Firebase에 데이터 저장 완료.");
        } catch (error) {
            console.error("Firebase 데이터 저장 오류:", error);
        }
    }

    // 기존 저장 함수를 Firebase 함수로 교체
    window.saveData = saveAllDataToFirebase;
    window.ic_saveData = saveAllDataToFirebase;

    // ----------------- 원본 JS의 모든 함수 정의 -----------------
    
    // 이 안에 원본 파일의 <script> 태그에 있던 모든 함수를 그대로 붙여넣습니다.
    // (ic_pFloat 부터 updateDatalists 까지)
    
    // 예시:
    window.ic_pFloat = (val) => parseFloat(String(val).replace(/,/g, '')) || 0;
    
    window.showTab = function(tabName) {
        document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');
        
        const activeTab = document.querySelector(`.tab[onclick="showTab('${tabName}')"]`);
        const activeContent = document.getElementById(tabName);

        if(activeTab) activeTab.classList.add('active');
        if(activeContent) activeContent.style.display = 'block';
        
        // (기타 원본 showTab 함수의 로직...)
    }
    
    // (이하 원본의 모든 함수를 window.함수명 = function() { ... } 형태로 정의합니다)
    // ...

    // ----------------- UI 초기화 및 이벤트 리스너 -----------------
    function initializeAppUI() {
        // 원본의 DOMContentLoaded 내부 로직을 여기에 넣습니다.
        transactions = transactions.map(t => ({...t, id: t.id || generateUniqueTransactionId(t)}));
        
        document.getElementById('logout-button').addEventListener('click', () => {
            auth.signOut().catch(error => console.error("Logout Error:", error));
        });

        // (기타 모든 addEventListener 호출들...)
        
        updateAll();
    }
    
    function updateAll() {
        recalculateInventory(); 
        applyFiltersAndRender(); 
        updateDatalists();
        saveData(); // Firebase에 저장
        // (기타 렌더링 함수...)
    }

    // 앱 실행 시작점
    loadAllDataFromFirebase();
}