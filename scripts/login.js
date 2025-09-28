// ************* 중요!! *************
// Firebase 콘솔에서 확인한 내 프로젝트의 설정 정보를 여기에 붙여넣으세요.
const firebaseConfig = {
apiKey: "AIzaSyDA0BNmhnr37KqyI7oj766TwB8FrejsRzo",
  authDomain: "my-inventory-final.firebaseapp.com",
  projectId: "my-inventory-final",
  storageBucket: "my-inventory-final.firebasestorage.app",
  messagingSenderId: "740246970535",
  appId: "1:740246970535:web:f7738b92a6097671f67b82",
  measurementId: "G-4ZF63VWX6Z"
};
// **********************************

// Firebase 앱 초기화
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginError = document.getElementById('login-error');

// 로그인 상태 감지: 이미 로그인 되어있으면 메인 페이지로 자동 이동
auth.onAuthStateChanged(user => {
    if (user) {
        window.location.href = 'index.html';
    }
});

// 로그인 폼 제출 이벤트 처리
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const email = emailInput.value;
    const password = passwordInput.value;
    
    loginError.textContent = ''; // 이전 오류 메시지 초기화

    auth.signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
            // 로그인 성공
            console.log('로그인 성공:', userCredential.user);
            window.location.href = 'index.html';
        })
        .catch((error) => {
            // 로그인 실패
            console.error('로그인 실패:', error);
            switch (error.code) {
                case 'auth/user-not-found':
                case 'auth/invalid-credential':
                    loginError.textContent = '이메일 또는 비밀번호가 잘못되었습니다.';
                    break;
                case 'auth/wrong-password':
                    loginError.textContent = '비밀번호가 틀렸습니다.';
                    break;
                case 'auth/invalid-email':
                    loginError.textContent = '유효하지 않은 이메일 형식입니다.';
                    break;
                default:
                    loginError.textContent = '로그인에 실패했습니다. 다시 시도해주세요.';
            }
        });
});
