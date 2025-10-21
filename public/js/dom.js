// to handle the hower case of header
document.addEventListener('DOMContentLoaded', function () {
    const button = document.querySelector('.relative .inline-flex');
    const dropdown = document.querySelector('.relative .hidden');

    button.addEventListener('mouseover', function () {
        dropdown.classList.remove('hidden');
    });

    button.addEventListener('mouseout', function () {
        dropdown.classList.add('hidden');
    });
});

//otp auto move to next field
function moveOnMax(current, nextFieldId) {
    if (current.value.length >= current.maxLength) {
        const nextField = document.getElementById(nextFieldId);
        if (nextField) {
            nextField.focus();
        }   
    }
}

//*********************************************************** */
//cart
//****************************************************************** */


function addToCart(event, productId) {
        console.log('entered add to cart')
        event.preventDefault();
        event.stopPropagation();
        const productStock = event.target.getAttribute('data-product-stock');
        console.log(productStock);

        if (productStock == 0) {
            console.error('Error: Product is out of stock.');
            toastr.error('Product is out of stock and cannot be added to the cart.');
            return;
        }

        const quantity = 1;

        console.log('Product ID:', productId);

        axios.post('/cart/addProduct', {
            products: [{ productId: productId, quantity: quantity }]
        })
            .then(response => {
                console.log('Success:', response.data);
                toastr.success(response.data.message);
                if (response.data.cartItemCount !== undefined) {
                    updateCartItemCount(response.data.cartItemCount);
                }
            })
            .catch(error => {
                console.error('Error:', error);
                toastr.error(error.response?.data?.message || 'Failed to add product to cart.');
            });
    }

    function updateCartItemCount(count) {
        const cartCountElement = document.getElementById('cart-count');
        if (cartCountElement) {
            cartCountElement.innerText = count;
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        console.log('DOM loaded');
        const addToCartButtons = document.querySelectorAll('.add-to-cart-btn');
        addToCartButtons.forEach(button => {
            button.addEventListener('click', addToCart);
        });
    });